import fs from 'node:fs';

import '../modules/configure-env.mjs'
import dbConnection from '../modules/db-connection.mjs';
import { jobOutput } from '../jobs/index.mjs';

process.env.VERBOSE_LOGS = 'true';

const localeJobs = [
    'update-traders',
    'update-item-cache',
    'update-hideout',
    'update-maps',
    'update-quests',
];

(async () => {
    const locales = {};
    for (const job of localeJobs) {
        try {
            const output = await jobOutput(job, false, 'regular', true);
            for (const langCode in output.locale) {
                if (!locales[langCode]) {
                    locales[langCode] = {};
                }
                for (const key in output.locale[langCode]) {
                    locales[langCode][key] = output.locale[langCode][key];
                }
            }
        } catch (error) {
            console.log(`Error running ${job} job`, error);
        }
    }
    fs.writeFileSync('./dumps/kv_locale_en.json', JSON.stringify(locales.en, null, 4));
    dbConnection.end();
})();