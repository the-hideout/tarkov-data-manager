const tarkovBot = require('../modules/tarkov-bot');
const spt = require('../modules/tarkov-spt');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

module.exports = async (externalLogger) => {
    const logger = externalLogger || new JobLogger('update-lang');
    try {
        logger.log('Downloading language data from Tarkov-Bot and SPT...');
        logger.time('lang-download');
        await Promise.all([
            //tarkovBot.locale('ru', true, logger),
            spt.locales(true),
        ]);
        logger.timeEnd('lang-download');
        logger.success('Successfully downloaded data from Tarkov-Bot and SPT');
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
}