if (process.env.NODE_ENV !== 'production') {
    const dotenv = require("dotenv");
    dotenv.config({path : './config.env'});
    dotenv.config({path : './creds.env'});
    process.env.NODE_ENV = 'dev';
    process.env.VERBOSE_LOGS = 'true';
}

const { connection, jobComplete } = require('./modules/db-connection');
const {runJob} = require('./jobs');

const kvJobs = [
    'update-barters',
    'update-crafts',
    'update-hideout',
    'update-historical-prices',
    'update-item-cache',
    'update-maps',
    'update-quests',
    'update-trader-prices',
    'update-traders'
];

(async () => {
    connection.keepAlive = true;
    for (const job of kvJobs) {
        try {
            await runJob(job);
        } catch (error) {
            console.log(`Error running ${job} job`, error);
        }
    }
    connection.keepAlive = false;
    jobComplete();
})();