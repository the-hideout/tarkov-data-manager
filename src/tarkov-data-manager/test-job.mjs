import './modules/configure-env.mjs';
import jobs from './jobs/index.mjs';
import dbConnection from './modules/db-connection.mjs';

process.env.VERBOSE_LOGS = 'true';
process.env.TEST_JOB = 'true';
console.log(`Running ${process.argv[2]}`);
(async () => {
    try {
        await jobs.runJob(process.argv[2]);
    } catch (error) {
        console.log(error);
    }
    dbConnection.end();
})();
