import './modules/configure-env.mjs'
import { keepAlive, jobComplete } from './modules/db-connection.mjs';
import {runJob} from './jobs/index.mjs';

process.env.VERBOSE_LOGS = 'true';

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
    keepAlive(true);
    for (const job of kvJobs) {
        try {
            await runJob(job);
        } catch (error) {
            console.log(`Error running ${job} job`, error);
        }
    }
    keepAlive(false);
    jobComplete();
})();