const schedule = require('node-schedule');

const runJob = function(name, cronSchedule) {
    const jobModule = require(`./${name}`);
    console.log(`Setting up ${name} job to run ${cronSchedule}`);

    schedule.scheduleJob(cronSchedule, () => {
        console.log(`Running ${name} job`);
        jobModule();
    });
}

module.exports = () => {
    // Only run in production
    if(process.env.NODE_ENV !== 'production'){
        return true;
    }

    // runJob('check-scans', '20 * * * *');
    runJob('update-cache', '* * * * *');

    runJob('update-barters', '*/5 * * * *');
    runJob('update-crafts', '1-59/5 * * * *');
    runJob('update-hideout', '2-59/5 * * * *')
    runJob('update-quests', '3-59/5 * * * *');
    runJob('update-existing-bases', '4-59/5 * * * *');

    runJob('game-data', '*/15 * * * *');
    runJob('update-historical-prices', '1-59/15 * * * *');

    runJob('update-trader-prices', '45 * * * *');

    runJob('clear-checkouts', '5 */6 * * *');

    runJob('verify-wiki', '5 9 * * *');
};
