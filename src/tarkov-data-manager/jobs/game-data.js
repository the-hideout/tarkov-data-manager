const tcData = require('./update-tc-data');
const updateNewItems = require('./update-new-items');
const updateItemNames = require('./update-item-names');
const updateTypes = require('./update-types');
const { connection, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

module.exports = async () => {
    const logger = new JobLogger('game-data');
    const keepAlive = connection.keepAlive;
    connection.keepAlive = true;
    try {
        logger.log('Running update-tc-data...');
        await tcData(logger);
        logger.log('Completed update-tc-data');

        logger.log('Running updateNewItems...');
        await updateNewItems(logger);
        logger.log('Completed updateNewItems');

        logger.log('Running updateItemNames...');
        await updateItemNames(logger);
        logger.log('Completed updateItemNames');

        logger.log('Running updateTypes...');
        await updateTypes(logger);
        logger.log('Completed updateTypes');
    } catch (error){
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    connection.keepAlive = keepAlive;

    // Possibility to POST to a Discord webhook here with cron status details
    await jobComplete();
    logger.end();
}