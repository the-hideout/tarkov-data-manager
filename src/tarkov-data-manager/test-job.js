if (process.env.NODE_ENV !== 'production') {
    const dotenv = require("dotenv");
    dotenv.config({path : './config.env'});
    dotenv.config({path : './creds.env'});
    process.env.NODE_ENV = 'dev';
    process.env.VERBOSE_LOGS = 'true';
}
const jobModule = require(`./jobs/${process.argv[2]}`);
console.log(`Running ${process.argv[2]}`);
jobModule();