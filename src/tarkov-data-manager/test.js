const chalk = require('chalk');

if (process.env.NODE_ENV !== 'production') {
    const dotenv = require("dotenv");
    dotenv.config({path : './creds.env'});
    dotenv.config({path : './config.env'});
    process.env.NODE_ENV = 'dev';
    process.env.VERBOSE_LOGS = 'true';
}

const remoteData = require('./modules/remote-data');
const cloudflare = require('./modules/cloudflare');
const s3 = require('./modules/upload-s3');
const {jobComplete, query} = require('./modules/db-connection');

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
