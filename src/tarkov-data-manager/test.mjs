import chalk from 'chalk';

import './modules/configure-env.mjs'
import remoteData from './modules/remote-data';
import cloudflare from './modules/cloudflare';
import s3 from './modules/upload-s3';
import {jobComplete, query} from './modules/db-connection';

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
    } catch (error) {
        console.log(error);
    }
    jobComplete();
})();
