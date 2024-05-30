import './modules/configure-env.mjs';
import jobs from './jobs/index.mjs';

process.env.VERBOSE_LOGS = 'true';
process.env.TEST_JOB = 'true';
console.log(`Running ${process.argv[2]}`);
jobs.runJob(process.argv[2]);
