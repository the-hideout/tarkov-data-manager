const fs = require('fs');

const { connection } = require('../modules/db-connection');

module.exports = async (jobName, outputFile, logger, rawOutput = false) => {
    try {
        const json = JSON.parse(fs.readFileSync(outputFile));
        if (!rawOutput && json.data) return json.data;
        return json;
    } catch (error) {
        logger.warn(`Could not parse ${outputFile}; running ${jobName} job`);
    }
    try {
        const keepAlive = connection.keepAlive;
        connection.keepAlive = true;
        const jobModule = require(`../jobs/${jobName}`);
        await jobModule(logger);
        connection.keepAlive = keepAlive;
    } catch (error) {
        logger.error(`Error running ${jobName}: ${error}`);
    }
    const json = JSON.parse(fs.readFileSync(outputFile));
    if (!rawOutput && json.data) return json.data;
    return json;
};