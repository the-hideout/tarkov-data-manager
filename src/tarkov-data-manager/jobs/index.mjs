import path from 'node:path';
import fs from 'node:fs';

import schedule from 'node-schedule';
import cron from 'cron-validator';

import emitter from '../modules/emitter.mjs';
import discord from '../modules/webhook.mjs';

const defaultJobTriggers = {
    'update-item-cache': '*/5 * * * *',
    'update-flea-prices': '8-59/10 * * * *',
    'game-data': '1-59/10 * * * *',
    //'update-barters': 'jobComplete_update-trader-prices',
    'update-quests': '3-59/10 * * * *',
    'update-maps': '4-59/10 * * * *',
    'check-scanners': '6,36 * * * *',
    //'update-td-data': '7-59/10 * * * *',
    'archive-prices': '38 0,12 * * *',
    'verify-wiki': '7 9 * * *',
    'update-trader-assorts': '47 */2 * * *',
    //'update-trader-prices': 'jobComplete_update-trader-assorts',
    'update-trader-offers': 'jobComplete_update-trader-assorts',
    'check-image-links': '16 0,6,12,18 * * *',
    'update-quest-images': '16 1,7,13,19 * * *',
    'update-historical-prices': '26 */2 * * *',
    'update-spt-data': '56 * * * *',
    'update-archived-prices': '38 0 * * *',
    'update-game-status': '*/15 * * * *',
    //'start-trader-scan': '30 9,21 * * *',
    'update-profile-index': '0 0 * * *',
};

// these jobs only run on the given schedule when not in dev mode
const nonDevJobTriggers = {};

// these jobs run at startup
const startupJobs = [
    'check-image-links',
    'update-main-data',
    'update-spt-data',
];

// these jobs run at startup when not in dev mode
const nonDevStartupJobs = [];

const jobClasses = {};
const jobFiles = fs.readdirSync('./jobs').filter(file => file.endsWith('.mjs'));
for (const file of jobFiles) {
    if (file === 'index.mjs') {
        continue;
    }
    await import(`./${file}`).then(jobClass => {
        jobClasses[file.replace('.mjs', '')] = jobClass.default;
    });
}

let jobTriggers = {
    ...defaultJobTriggers
};
try {
    const customJobs = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'settings', 'crons.json')));
    for (const jobName of Object.keys(customJobs)) {
        if (!jobClasses[jobName]) {
            console.warn(`${jobName} is not a valid job; excluding from custom schedule`);
            customJobs[jobName] = undefined;
            continue;
        }
        jobTriggers[jobName] = customJobs[jobName];
    }
} catch (error) {
    if (error.code !== 'ENOENT') console.log(`Error parsing custom cron jobs`, error);
}
if (process.env.NODE_ENV !== 'dev') {
    jobTriggers = {
        ...jobTriggers,
        ...nonDevJobTriggers
    };
}

const jobs = {};

const scheduleJob = function(name, cronSchedule) {
    if (!jobs[name]) {
        throw new Error(`Can't schedule ${name}; not a valid job`);
    }
    if (jobs[name].cronTrigger) {
        jobs[name].cronTrigger.cancel();
    }
    if (jobs[name].eventTrigger) {
        emitter.off(jobs[name].eventTrigger.name, jobs[name].eventTrigger.listener);
    }
    if (!cronSchedule) {
        return;
    }
    const isCron = cron.isValidCron(cronSchedule);
    console.log(`Setting up ${name} job to run${isCron ? '' : ' on'} ${cronSchedule}`);

    const jobFunction = async () => {
        if (process.env.SKIP_JOBS === 'true') {
            console.log(`Skipping ${name} job`);
            return;
        }
        console.log(`Running ${name} job`);
        console.time(name);
        try {
            await jobManager.runJob(name, false, false);
        } catch (error) {
            console.log(`Error running ${name} job: ${error}`);
            discord.alert({
                title: `Error running job ${name}: ${error.message}`,
                message: error.stack,
            });
        }
        console.timeEnd(name);
    };
    if (isCron) {
        jobs[name].cronTrigger = schedule.scheduleJob(cronSchedule, jobFunction);
    } else {
        emitter.on(cronSchedule, jobFunction);
        jobs[name].eventTrigger = {
            name: cronSchedule,
            listener: jobFunction,
        };
    }
}

const jobManager = {
    start: async () => {
        // Only run in production
        /*if(process.env.NODE_ENV !== 'production'){
            return true;
        }*/
    
        for (const jobName in jobTriggers) {
            try {
                scheduleJob(jobName, jobTriggers[jobName]);
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
                await jobManager.runJob(jobName);
            } catch (error) {
                console.log(`Error running ${jobName}: ${error}`);
                discord.alert({
                    title: `Error running job ${name}: ${error.message}`,
                    message: error.stack,
                });
            }
        }
        let buildPresets = false;
        try {
            fs.accessSync(path.join(import.meta.dirname, '..', 'cache', 'presets.json'))
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
            jobManager.runJob('update-presets').finally(() => {
                resolve(true);
            });
        });
        await Promise.allSettled([promise]);
        console.log('Startup jobs complete');
    },
    abortJob: async (jobName) => {
        if (!jobs[jobName]) {
            return  Promise.reject(new Error(`${jobName} is not a valid job`));
        }
        if (!jobs[jobName].running) {
            return Promise.reject (new Error(`${jobName} is not running`));
        }
        return new Promise((resolve) => {
            emitter.once(`jobComplete_${jobName}`, resolve);
            jobs[jobName].abortController.abort();
        });
    },
    stop: () => {
        return schedule.gracefulShutdown();
    },
    lastRun: (jobName) => {
        try {
            const stats = fs.statSync(path.join(import.meta.dirname, '..', 'logs', `${jobName}.log`));
            return stats.mtime;
        } catch (error) {
            if (error.code !== 'ENOENT') console.log(`Error getting ${jobName} last run`, error);
        }
        return null;
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
            jobResults.push({
                name: jobName,
                schedule: jobTriggers[jobName] ?? '',
                lastRun: jobManager.lastRun(jobName),
                nextRun: jobs[jobName].cronTrigger?.nextInvocation() ?? false,
                running: jobs[jobName]?.running,
                startDate: jobs[jobName].startDate,
            });
        }
        return jobResults;
    },
    setSchedule: (jobName, jobSchedule) => {
        if (!jobSchedule) {
            jobSchedule = undefined;
        }
        if (jobSchedule === 'default') {
            if (!defaultJobTriggers[jobName]) {
                jobSchedule = undefined;
            } else {
                jobSchedule = defaultJobTriggers[jobName];
            }
        }
        scheduleJob(jobName, jobSchedule);
        jobTriggers[jobName] = jobSchedule;
        const customJobs = {};
        for (const jobName in jobTriggers) {
            if (!jobs[jobName]) {
                continue;
            }
            if (jobTriggers[jobName] !== defaultJobTriggers[jobName]) {
                customJobs[jobName] = jobTriggers[jobName];
            }
        }
        fs.writeFileSync(path.join(import.meta.dirname, '..', 'settings', 'crons.json'), JSON.stringify(customJobs, null, 4));
    },
    runJob: async (jobName, options, bumpSchedule = true) => {
        if (!jobs[jobName]) {
            return Promise.reject(new Error(`${jobName} is not a valid job`));
        }
        if (jobs[jobName].cronTrigger) {
            const scheduledJob = jobs[jobName].cronTrigger;
            const nextInvocation = scheduledJob.nextInvocation();
            if (scheduledJob && bumpSchedule && nextInvocation) {const nextRunMinusFive = nextInvocation.toDate();
                nextRunMinusFive.setMinutes(nextRunMinusFive.getMinutes() - 5);
                if (new Date() > nextRunMinusFive) {
                    scheduledJob.cancelNext(true);
                }
            }
            jobs[jobName].nextInvocation = nextInvocation?.toDate();
        } else if (jobs[jobName].eventTrigger) {
            if (jobs[jobName].lastCompletion) {
                const elapsed = new Date().getTime() - jobs[jobName].lastCompletion.getTime();
                jobs[jobName].nextInvocation = new Date(new Date().getTime() + elapsed);
            } else {
                jobs[jobName].nextInvocation = new Date(new Date().getTime() + (1000 * 60 * 30));
            }
        }
        return jobs[jobName].start(options);
    },
    jobOutput: async (jobName, parentJob, gameMode = 'regular', rawOutput = false) => {
        const job = jobs[jobName];
        if (!job) {
            return Promise.reject(new Error(`Job ${jobName} is not a valid job`));
        }
        let suffix = '';
        if (gameMode !== 'regular') {
            suffix = `_${gameMode}`;
        }
        const outputFile = `./${job.writeFolder}/${job.kvName}${suffix}.json`;
        let logger = false;
        if (parentJob && parentJob.logger) {
            logger = parentJob.logger;
        }
        try {
            const json = JSON.parse(fs.readFileSync(outputFile));
            if (!rawOutput) return json[Object.keys(json).find(key => key !== 'updated' && key !== 'locale')];
            return json;
        } catch (error) {
            if (logger) {
                logger.warn(`Output ${outputFile} missing; running ${jobName} job`);
            } else {
                console.log(`Output ${outputFile} missing; running ${jobName} job`);
            }
        }
        return jobManager.runJob(jobName, {parent: parentJob}).then(result => {
            let returnResult = result;
            if (returnResult[gameMode]) {
                returnResult = returnResult[gameMode];
            }
            if (!rawOutput) {
                returnResult = returnResult[Object.keys(result).find(key => key !== 'updated')];
            }
            return returnResult;
        });
    },
    currentLog: (jobName) => {
        const job = jobs[jobName];
        if (!job) {
            return Promise.reject(new Error(`Job ${jobName} is not a valid job`));
        }
        if (!job.running) {
            return undefined;
        }
        const logger = job.parentLogger || job.logger;
        
        return logger.messages;
    },
};

for (const jobClassName in jobClasses) {
    jobs[jobClassName] = new jobClasses[jobClassName]({jobManager});
    jobs[jobClassName].jobManager = jobManager;
}

export const { jobOutput } = jobManager;

export default jobManager;
