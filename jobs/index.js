const schedule = require('node-schedule');

const runJob = function(name, cronSchedule) {
    const jobModule = require(`./${name}`);
    console.log(`Setting up ${name} job to run ${cronSchedule}`);

    schedule.scheduleJob(cronSchedule, () => {
        console.log(`Running ${name} job`);
        jobModule();
    });
}

const startupJobs = [
    'update-existing-bases',
];

module.exports = () => {
    // Only run in production
    if(process.env.NODE_ENV !== 'production'){
        return true;
    }

    // runJob('check-scans', '20 * * * *');
    runJob('update-cache', '* * * * *');
    runJob('update-reset-timers', '* * * * *');

    runJob('update-barters', '*/5 * * * *');
    runJob('update-crafts', '1-59/5 * * * *');
    runJob('update-hideout', '2-59/5 * * * *')
    runJob('update-quests', '3-59/5 * * * *');
    runJob('update-existing-bases', '4-59/5 * * * *');

    runJob('game-data', '*/15 * * * *');
    runJob('update-historical-prices', '5-59/15 * * * *');

    runJob('update-item-properties', '15 * * * *');
    runJob('update-trader-prices', '45 * * * *');
    runJob('update-currency-prices', '0 3,15 * * *');

    runJob('clear-checkouts', '5 */6 * * *');

    runJob('verify-wiki', '5 9 * * *');

    // Too much memory :'(
    // runJob('update-longtime-data', '49 8 * * *');

    for (let i = 0; i < startupJobs.length; i++) {
        const jobName = startupJobs[i];
        const jobModule = require(`./${jobName}`);
        console.log(`Running ${jobName} job at startup`);
        jobModule();
    }
};
