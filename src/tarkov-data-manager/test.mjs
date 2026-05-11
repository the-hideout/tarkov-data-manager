import fs from 'node:fs';
import path from 'node:path';

import chalk from 'chalk';

import './modules/configure-env.mjs'
import remoteData from './modules/remote-data.mjs';
import cloudflare from './modules/cloudflare.mjs';
import s3 from './modules/upload-s3.mjs';
import dbConnection from './modules/db-connection.mjs';
import tarkovChanges from './modules/tarkov-data-tarkov-changes.mjs';
import spt from './modules/tarkov-data-spt.mjs';
import mData from './modules/tarkov-data-md.mjs';

process.env.VERBOSE_LOGS = 'true';

(async () => {
    try {
        /*const response = await cloudflare.getOldKeys();
        badkeys = [];
        for (const kv of response.result) {
            if (kv.name.indexOf('historical-prices-') === 0) {
                badkeys.push(kv.name);
            }
        }
        console.log(badkeys);*/
        const newLocales = {
            en: await tarkovChanges.locale_en({download: true}),
        };
        const oldLocales = await spt.locales({download: true});
        const mLocales = await mData.locales({download: true});
        for (const langCode in mLocales) {
            newLocales[langCode] = mLocales[langCode];
        }
        const missingLocales = {};
        for (const langCode in oldLocales) {
            missingLocales[langCode] = {};
            for (const key in oldLocales[langCode]) {
                if (newLocales[langCode][key]) {
                    continue;
                }
                if (!oldLocales[langCode][key]) {
                    continue;
                }
                missingLocales[langCode][key] = oldLocales[langCode][key];
            }
        }

        const dataPath = path.join('data', 'locale');
        if (!fs.existsSync(dataPath)) {
            fs.mkdirSync(dataPath, { recursive: true });
        }
        for (const langCode in missingLocales) {
            if (!Object.keys(missingLocales[langCode])) {
                continue;
            }
            fs.writeFileSync(path.join(dataPath, `${langCode}.json`), JSON.stringify(missingLocales[langCode], null, 4));
        }

        /*const zhTranslation = JSON.parse(fs.readFileSync(path.join('translations', 'zh.json')));
        for (const key in zhTranslation) {
            if (newLocales.zh[key]) {
                delete zhTranslation[key];
                continue;
            }
            if (oldLocales.zh[key] === zhTranslation[key]) {
                delete zhTranslation[key];
            }
        }
        fs.writeFileSync(path.join('translations', 'zh.json'), JSON.stringify(zhTranslation, null, 4));*/
    } catch (error) {
        console.log(error);
    }
    dbConnection.end();
})();
