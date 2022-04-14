const chalk = require('chalk');

if (process.env.NODE_ENV !== 'production') {
    const dotenv = require("dotenv");
    dotenv.config({path : './config.env'});
    dotenv.config({path : './creds.env'});
    process.env.NODE_ENV = 'dev';
    process.env.VERBOSE_LOGS = 'true';
}

const remoteData = require('./modules/remote-data');
const {jobComplete, query} = require('./modules/db-connection');

(async () => {
    try {
        const result = await query(`select * from item_data where id='61a6446f4b5f8b70f451b166'`);
        console.log(result);
    } catch (error) {
        console.log(error);
    }
    jobComplete();
})();
