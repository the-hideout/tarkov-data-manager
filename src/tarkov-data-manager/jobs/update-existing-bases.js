const fs = require('fs');
const path = require('path');

const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const { jobComplete } = require('../modules/db-connection');
const remoteData = require('../modules/remote-data');

module.exports = async () => {
    const logger = new JobLogger('update-existing-bases');
    try {
        const itemdData = await remoteData.get();

        const baseKeys = [];

        for (const [id, item] of itemdData) {
            if (item.base_image_link) {
                baseKeys.push(id);
            }
        }

        fs.writeFileSync(path.join(__dirname, '..', 'public', 'data', 'existing-bases.json'), JSON.stringify(baseKeys, null, 4));
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
    await jobComplete();
}
