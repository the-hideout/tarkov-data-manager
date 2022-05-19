const tarkovChanges = require('../modules/tarkov-changes');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

module.exports = async () => {
    const logger = new JobLogger('update-tc-data');
    try {
        logger.log('Downloading data from Tarkov-Changes...');
        logger.time('tc-download');
        await tarkovChanges.downloadAll();
        logger.timeEnd('tc-download');
        logger.success('Successfully downloaded data from Tarkov-Changes');
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
}