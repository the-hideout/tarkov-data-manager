const remoteData = require('../modules/remote-data');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');

module.exports = async (externalLogger) => {
    const logger = externalLogger || new JobLogger('update-types');
    try {
        const allItems = await remoteData.get(true);
        const bsgData = await tarkovChanges.items();

        logger.log(`Updating types`);
        for (const [itemId, item] of allItems.entries()) {
            if (item.types.includes('preset')) {
                if (!item.types.includes('preset')) {
                    logger.warn(`${itemId} ${item.name} is not marked as a preset`);
                    await query(`INSERT IGNORE INTO types (item_id, type) VALUES(?, 'preset')`, [itemId]).then(results => {
                        if (results.affectedRows == 0) {
                            logger.fail(`Already market as preset ${itemId} ${item.name}`);
                        }
                    });
                }
                continue;
            }
            //logger.log(`Checking ${itemId} ${item.name}`)
            try {
                if (!bsgData[itemId]) {
                    if (!item.types.includes('disabled')) {
                        logger.warn(`${itemId} ${item.name} is no longer in the game, disabling`);
                        await query(`INSERT IGNORE INTO types (item_id, type) VALUES(?, 'disabled')`, [itemId]).then(results => {
                            if (results.affectedRows == 0) {
                                logger.fail(`Already disabled ${itemId} ${item.name}`);
                            }
                        });
                    }
                    continue;
                }
                if(!bsgData[itemId]?._props){
                    continue;
                }
                if(item.types.includes('no-flea') && bsgData[itemId]._props.CanSellOnRagfair){
                    logger.warn(`You can sell ${itemId} ${item.name} on flea, but it is marked as noFlea`);

                    await query(`DELETE FROM types WHERE item_id = ? AND type = 'no-flea'`, [itemId]).then(results => {
                        if (results.affectedRows == 0) {
                            logger.fail(`Not marked as no-flea ${itemId} ${item.name}`);
                        }
                    });
                } else if(!item.types.includes('no-flea') && !bsgData[itemId]._props.CanSellOnRagfair){
                    logger.warn(`You can't sell ${itemId} ${item.name} on flea`);
        
                    await query(`INSERT IGNORE INTO types (item_id, type) VALUES(?, 'no-flea')`, [itemId]).then(results => {
                        if (results.affectedRows == 0) {
                            logger.fail(`Already marked as no-flea ${itemId} ${item.name}`);
                        }
                    });
                }
                if (bsgData[itemId]._parent === '543be5cb4bdc2deb348b4568') {
                    if (!item.types.includes('ammo-box')) {
                        logger.warn(`Assigning ${itemId} ${item.name} ammoBox category`);
        
                        await query(`INSERT IGNORE INTO types (item_id, type) VALUES(?, 'ammo-box')`, [itemId]).then(results => {
                            if (results.affectedRows == 0) {
                                logger.fail(`Already marked as ammo-box ${itemId} ${item.name}`);
                            }
                        });
                    }
                    const ammoContents = bsgData[itemId]._props.StackSlots[0];
                    const count = ammoContents._max_count;
                    const round = ammoContents._props.filters[0].Filter[0]
                    await query(`
                        INSERT IGNORE INTO 
                            item_children (container_item_id, child_item_id, count)
                        VALUES (?, ?, ?)
                    `, [itemId, round, count]);
                }
                if (bsgData[bsgData[itemId]._parent] && bsgData[bsgData[itemId]._parent]._parent === '5422acb9af1c889c16000029') {
                    if (!item.types.includes('gun')) {
                        logger.warn(`Assigning ${itemId} ${item.name} gun category`);
        
                        await query(`INSERT IGNORE INTO types (item_id, type) VALUES(?, 'gun')`, [itemId]).then(results => {
                            if (results.affectedRows == 0) {
                                logger.fail(`Already marked as gun ${itemId} ${item.name}`);
                            }
                        });
                    }
                }
            } catch (error){
                logger.error(error);
                logger.end();
                jobComplete();
                return Promise.reject(error);
            }
        };
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    if (!externalLogger) logger.end();
    await jobComplete();
};