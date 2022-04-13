const bsgData = require('./update-bsg-data');
const updateGameData = require('./update-game-data');
const updateTranslations = require('./update-translations');
const updateTypes = require('./update-types');
const { connection, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

module.exports = async () => {
    const logger = new JobLogger('game-data');
    const keepAlive = connection.keepAlive;
    connection.keepAlive = true;
    try {
        logger.log('Running bsgData...');
        await bsgData(logger);
        logger.log('Completed bsgData');

        logger.log('Running updateGameData...');
        await updateGameData(logger);
        logger.log('Completed updateGameData');

        logger.log('Running updateTranslations...');
        await updateTranslations(logger);
        logger.log('Completed updateTranslations');

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