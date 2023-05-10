const fs = require('fs');

if (process.env.NODE_ENV !== 'production') {
    const dotenv = require("dotenv");
    dotenv.config({path : './config.env'});
    dotenv.config({path : './creds.env'});
    process.env.NODE_ENV = 'dev';
    process.env.VERBOSE_LOGS = 'true';
}

const { connection, jobComplete } = require('../modules/db-connection');
const { jobOutput } = require('../jobs');

const localeJobs = [
    'update-traders',
    'update-item-cache',
    'update-hideout',
    'update-maps',
    'update-quests',
];

(async () => {
    connection.keepAlive = true;
    const locales = {};
    for (const job of localeJobs) {
        try {
            const output = await jobOutput(job, false, true);
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
    connection.keepAlive = false;
    jobComplete();
})();