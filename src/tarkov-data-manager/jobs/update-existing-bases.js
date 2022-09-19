const fs = require('fs');
const path = require('path');

const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const { jobComplete } = require('../modules/db-connection');
const remoteData = require('../modules/remote-data');

module.exports = async () => {
    const logger = new JobLogger('update-existing-bases');
    try {
        const itemData = await remoteData.get();

        const activeItems = [...itemData.values()].filter(item => !item.types.includes('disabled'));

        const baseKeys = [];

        for (item of activeItems) {
            if (item.base_image_link) {
                baseKeys.push(item.id);
            }
        }

        logger.log(`${baseKeys.length} of ${activeItems.length} active items have base images`);
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
