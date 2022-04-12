const bsgData = require('./update-bsg-data');
const updateGameData = require('./update-game-data');
const updateTranslations = require('./update-translations');
const updateTypes = require('./update-types');
const { connection, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');

module.exports = async () => {
    const logger = new JobLogger('game-data');
    const keepAlive = connection.keepAlive;
    connection.keepAlive = true;
    try {
        logger.log('Running bsgData...');
        await bsgData();
        logger.log('Completed bsgData...');
    } catch (updateError){
        logger.error(updateError);
        await jobComplete();
        logger.end();
        return false;
    }

    try {
        logger.log('Running updateGameData...');
        await updateGameData();
        logger.log('Completed updateGameData...');
    } catch (updateError){
        logger.error(updateError);
        await jobComplete();
        logger.end();

        return false;
    }

    try {
        logger.log('Running updateTranslations...');
        await updateTranslations();
        logger.log('Completed updateTranslations...');
    } catch (updateError){
        logger.error(updateError);
    }

    try {
        logger.log('Running updateTypes...');
        await updateTypes();
        logger.log('Completed updateTypes...');
    } catch (updateError){
        logger.error(updateError);
    }
    connection.keepAlive = keepAlive;

    // Possibility to POST to a Discord webhook here with cron status details
    await jobComplete();
    logger.end();
}