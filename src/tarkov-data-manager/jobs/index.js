const path = require('path');
const fs = require('fs');

const schedule = require('node-schedule');

const defaultJobs = {
    //'check-scanners': '5,35 * * * *',
    //'update-item-cache': '*/5 * * * *',
    //'update-barters': '*/5 * * * *',
    //'check-image-links': '37 0,6,12,18 * * *',
    //'game-data': '*/10 * * * *',
    //'update-historical-prices': '30 * * * *',
    //'update-trader-prices': '25 9,21 * * *',
    //'update-trader-assorts': '15 9,21 * * *',
    //'verify-wiki': '5 9 * * *',
    //'update-quests': '7-59/10 * * * *',
    //'update-maps': '*/10 * * * *',
    //'update-spt-data': '*/61 * * * *',
};
// Too much memory :'(
// 'update-longtime-data': '49 8 * * *'

// these jobs only run on the given schedule when not in dev mode
const nonDevJobs = {};

// these jobs run at startup
const startupJobs = [
    'check-image-links',
    'update-tc-data',
    'update-spt-data',
];

// these jobs run at startup when not in dev mode
const nonDevStartupJobs = [];

let allJobs = {
    ...defaultJobs
};
try {
    const customJobs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'settings', 'crons.json')));
    allJobs = {
        ...defaultJobs,
        ...customJobs
    };
} catch (error) {
    if (error.code !== 'ENOENT') console.log(`Error parsing custom cron jobs`, error);
}
if (process.env.NODE_ENV !== 'dev') {
    allJobs = {
        ...allJobs,
        ...nonDevJobs
    };
}

const jobs = {};
const jobClasses = {};
const scheduledJobs = {};

const jobFiles = fs.readdirSync('./jobs').filter(file => file.endsWith('.js'));

for (const file of jobFiles) {
    if (file === 'index.js') {
        continue;
    }
    const jobClass = require(`./${file}`);
    jobClasses[file.replace('.js', '')] = jobClass;
}

const runJob = async (jobName, options, bumpSchedule = true) => {
    if (!jobs[jobName]) {
        return Promise.reject(new Error(`${jobName} is not a valid job`));
    }
    if (scheduledJobs[jobName]) {
        const scheduledJob = scheduledJobs[jobName];
        if (scheduledJob && bumpSchedule) {
            const nextInvocation = scheduledJob.nextInvocation();
            if (nextInvocation) {
                const nextRunMinusFive = nextInvocation.toDate();
                nextRunMinusFive.setMinutes(nextRunMinusFive.getMinutes() - 5);
                if (new Date() > nextRunMinusFive) {
                    scheduledJob.cancelNext(true);
                }
            }
        }
        jobs[jobName].nextInvocation = scheduledJob.nextInvocation().toDate();
    }
    return jobs[jobName].start(options);
}

const jobOutput = async (jobName, parentJob, rawOutput = false) => {
    const job = jobs[jobName];
    if (!job) {
        return Promise.reject(new Error(`Job ${jobName} is not a valid job`));
    }
    const outputFile = `./${job.writeFolder}/${job.kvName}.json`;
    logger = false;
    if (parentJob && parentJob.logger) {
        logger = parentJob.logger;
    }
    try {
        const json = JSON.parse(fs.readFileSync(outputFile));
        if (!rawOutput) return json[Object.keys(json).find(key => key !== 'updated')];
        return json;
    } catch (error) {
        if (logger) {
            logger.warn(`Output ${outputFile} missing; running ${jobName} job`);
        } else {
            console.log(`Output ${outputFile} missing; running ${jobName} job`);
        }
    }
    return runJob(jobName, {parent: parentJob}).then(result => {
        if (!rawOutput) return result[Object.keys(result).find(key => key !== 'updated')];
        return result;
    });
}

for (const jobClassName in jobClasses) {
    jobs[jobClassName] = new jobClasses[jobClassName]();
    jobs[jobClassName].jobManager = {runJob, jobOutput};
}

const scheduleJob = function(name, cronSchedule) {
    if (!cronSchedule) {
        console.log(`Unscheduling ${name} job`);
        if (scheduledJobs[name]) {
            scheduledJobs[name].cancel();
        }
        return;
    }
    if (!jobs[name]) {
        return;
    }
    console.log(`Setting up ${name} job to run ${cronSchedule}`);

    const job = schedule.scheduleJob(cronSchedule, async () => {
        if (process.env.SKIP_JOBS === 'true') {
            console.log(`Skipping ${name} job`);
            return;
        }
        console.log(`Running ${name} job`);
        console.time(name);
        try {
            await runJob(name, false, false);
        } catch (error) {
            console.log(`Error running ${name} job: ${error}`);
        }
        console.timeEnd(name);
    });
    jobs[name].cronSchedule = cronSchedule;
    if (scheduledJobs[name]) {
        scheduledJobs[name].cancel();
    }
    scheduledJobs[name] = job;
}

const startJobs = async () => {
    // Only run in production
    /*if(process.env.NODE_ENV !== 'production'){
        return true;
    }*/

    for (const jobName in allJobs) {
        try {
            scheduleJob(jobName, allJobs[jobName]);
        } catch (error) {
            console.log(`Error setting up ${jobName} job`, error);
        }
    }

    let allStartupJobs = [...startupJobs];
    if (process.env.NODE_ENV !== 'dev') {
        allStartupJobs = [
            ...startupJobs,
            ...nonDevStartupJobs
        ];
    }
    for (let i = 0; i < allStartupJobs.length; i++) {
        const jobName = allStartupJobs[i];
        if (process.env.SKIP_JOBS === 'true') {
            console.log(`Skipping ${jobName} startup job`);
            continue;
        }
        console.log(`Running ${jobName} job at startup`);
        try {
            await runJob(jobName);
        } catch (error) {
            console.log(`Error running ${jobName}: ${error}`);
        }
    }
    let buildPresets = false;
    try {
        fs.accessSync(path.join(__dirname, '..', 'cache', 'presets.json'))
    } catch (error) {
        if (error.code === 'ENOENT') {
            buildPresets = true;
        } else {
            console.log(error);
        }
    }
    const promise = new Promise((resolve, reject) => {
        if (!buildPresets) return resolve(true);
        console.log('Running build-presets job at startup');
        runJob('update-presets').finally(() => {
            resolve(true);
        });
    });
    await Promise.allSettled([promise]);
    console.log('Startup jobs complete');
};

module.exports = {
    start: startJobs,
    stop: () => {
        return schedule.gracefulShutdown();
    },
    schedules: () => {
        const ignoreJobs = [
            'update-hideout-legacy',
            'update-longtime-data',
            'update-quests-legacy',
            'update-queue-times',
            'update-reset-timers',
        ];
        const jobResults = [];
        for (const jobName in jobClasses) {
            if (ignoreJobs.includes(jobName)) {
                continue;
            }
            const jobResult = {
                name: jobName,
                schedule: allJobs[jobName] || '',
                lastRun: false,
                nextRun: false,
                running: jobs[jobName]?.running,
            };
            try {
                const stats = fs.statSync(path.join(__dirname, '..', 'logs', `${jobName}.log`));
                jobResult.lastRun = stats.mtime;
            } catch (error) {
                if (error.code !== 'ENOENT') console.log(`Error getting ${jobName} last run`, error);
            }
            if (scheduledJobs[jobName]) {
                jobResult.nextRun = scheduledJobs[jobName].nextInvocation();
            }
            jobResults.push(jobResult);
        }
        return jobResults;
    },
    setSchedule: (jobName, cronSchedule) => {
        if (!cronSchedule) {
            cronSchedule = undefined;
        }
        if (cronSchedule === 'default') {
            if (!defaultJobs[jobName]) {
                cronSchedule = undefined;
            } else {
                cronSchedule = defaultJobs[jobName];
            }
        }
        scheduleJob(jobName, cronSchedule);
        allJobs[jobName] = cronSchedule;
        const customJobs = {};
        for (const job in allJobs) {
            if (allJobs[job] !== defaultJobs[job]) {
                customJobs[job] = allJobs[job];
            }
        }
        fs.writeFileSync(path.join(__dirname, '..', 'settings', 'crons.json'), JSON.stringify(customJobs, null, 4));
    },
    runJob: runJob,
    jobOutput: jobOutput,
};
