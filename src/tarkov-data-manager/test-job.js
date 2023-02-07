if (process.env.NODE_ENV !== 'production') {
    const dotenv = require("dotenv");
    dotenv.config({path : './config.env'});
    dotenv.config({path : './creds.env'});
    process.env.NODE_ENV = 'dev';
    process.env.VERBOSE_LOGS = 'true';
}
process.env.TEST_JOB = 'true';
console.log(`Running ${process.argv[2]}`);
const jobs = require('./jobs');
jobs.runJob(process.argv[2]);