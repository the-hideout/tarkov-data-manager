const fs = require('fs');
const path = require('path');

const ttData = require('../modules/tt-data');
const {query, jobComplete} = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

module.exports = async () => {
    const logger = new JobLogger('update-types');
    try {
        const allTTItems = await ttData();
        const bsgData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bsg-data.json')));

        logger.log(`Updating types`);
        let i = 0;
        for(const itemId in allTTItems){
            const item = allTTItems[itemId];
            i = i + 1;
            // console.log(`Updating ${i + 1}/${Object.keys(allTTItems).length} ${itemId} ${item.shortName}`);

            if(!bsgData[itemId]?._props){
                continue;
            }

            //logger.log(`Checking ${itemId} ${item.name}`)
            try {
                if(item.types.includes('noFlea') && bsgData[itemId]._props.CanSellOnRagfair){
                    logger.warn(`You can sell ${itemId} ${item.name} on flea, but it is marked as noFlea`);

                    await query(`DELETE FROM types WHERE item_id = ? AND type = 'no-flea'`, [itemId]).then(results => {
                        if (results.affectedRows == 0) {
                            logger.fail(`Not marked as no-flea ${itemId} ${item.name}`);
                        }
                    });
                } else if(!item.types.includes('noFlea') && !bsgData[itemId]._props.CanSellOnRagfair){
                    logger.warn(`You can't sell ${itemId} ${item.name} on flea`);
        
                    await query(`INSERT IGNORE INTO types (item_id, type) VALUES(?, 'no-flea')`, [itemId]).then(results => {
                        if (results.affectedRows == 0) {
                            logger.fail(`Already marked as no-flea ${itemId} ${item.name}`);
                        }
                    });
                }
            } catch (error){
                logger.error(error);
                logger.end();
                jobComplete();
                return Promise.reject(error);
            }
        }
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
    await jobComplete();
};