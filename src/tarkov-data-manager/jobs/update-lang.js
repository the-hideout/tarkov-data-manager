const tarkovBot = require('../modules/tarkov-bot');
const tarkovChanges = require('../modules/tarkov-changes');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

module.exports = async (externalLogger) => {
    const logger = externalLogger || new JobLogger('update-lang');
    try {
        logger.log('Downloading language data from Tarkov-Bot...');
        logger.time('tb-download');
        //await tarkovBot.locales(true, logger);
        await tarkovBot.dictionary(true, 'locale_ru.json', 'ru')
        logger.timeEnd('tb-download');
        logger.success('Successfully downloaded data from Tarkov-Bot');
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
}