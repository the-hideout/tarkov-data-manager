const path = require('path');
const fs = require('fs');

const schedule = require('node-schedule');

const runJob = function(name, cronSchedule) {
    const jobModule = require(`./${name}`);
    console.log(`Setting up ${name} job to run ${cronSchedule}`);

    const job = schedule.scheduleJob(cronSchedule, async () => {
        //console.log(`Running ${name} job`);
        try {
            await jobModule();
        } catch (error) {
            console.log(`Error running ${name} job: ${error}`);
        }
    });
    if (scheduledJobs[name]) {
        scheduledJobs[name].cancel();
    }
    scheduledJobs[name] = job;
}

const defaultJobs = {
    'check-scans': '20 * * * *',
    'update-cache': '*/5 * * * *',
    'update-reset-timers': '*/5 * * * *',
    'update-barters': '*/5 * * * *',
    'update-crafts': '1-59/5 * * * *',
    'update-hideout': '2-59/5 * * * *',
    'update-quests': '3-59/5 * * * *',
    'update-existing-bases': '4-59/5 * * * *',
    'game-data': '*/5 * * * *',
    'update-historical-prices': '5-59/15 * * * *',
    'update-item-properties': '15 * * * *',
    'update-trader-prices': '25 9,21 * * *',
    //'update-currency-prices': '50 * * * *',
    'clear-checkouts': '5,35 * * * *',
    'verify-wiki': '5 9 * * *',
    'update-tc-data': '*/10 * * * *',
    'update-ammo': '*/10 * * * *'
    // Too much memory :'(
    // 'update-longtime-data': '49 8 * * *'
};

const startupJobs = [
    'update-existing-bases',
    'update-tc-data'
];

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

const scheduledJobs = {};

const startJobs = async () => {
    // Only run in production
    /*if(process.env.NODE_ENV !== 'production'){
        return true;
    }*/

    for (const jobName in allJobs) {
        try {
            runJob(jobName, allJobs[jobName]);
        } catch (error) {
            console.log(`Error setting up ${jobName} job`, error);
        }
    }

    for (let i = 0; i < startupJobs.length; i++) {
        const jobName = startupJobs[i];
        const jobModule = require(`./${jobName}`);
        console.log(`Running ${jobName} job at startup`);
        try {
            await jobModule();
        } catch (error) {
            console.log(`Error running ${jobName}: ${error}`);
        }
    }
};

module.exports = {
    start: startJobs,
    stop: () => {
        return schedule.gracefulShutdown();
    },
    schedules: () => {
        const jobResults = [];
        for (const jobName in allJobs) {
            const jobResult = {
                name: jobName,
                schedule: allJobs[jobName],
                lastRun: false,
                nextRun: false
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
        runJob(jobName, cronSchedule);
        allJobs[jobName] = cronSchedule;
        const customJobs = {};
        for (jobName in allJobs) {
            console.log(`${allJobs[jobName]} : ${defaultJobs[jobName]}`);
            if (allJobs[jobName] !== defaultJobs[jobName]) {
                customJobs[jobName] = allJobs[jobName];
            }
        }
        console.log(customJobs);
        fs.writeFileSync(path.join(__dirname, '..', 'settings', 'crons.json'), JSON.stringify(customJobs, null, 4));
    },
    runJob: jobName => {
        if (!allJobs[jobName]) throw new Error(`${jobName} is not a valid job`);
        const jobModule = require(`./${jobName}`);
        if (scheduledJobs[jobName]) {
            const job = scheduledJobs[jobName];
            if (new Date() > job.nextInvocation()._date - (1000 * 60 * 5)) {
                job.cancelNext(true);
            }
        }
        jobModule();
    }
};
