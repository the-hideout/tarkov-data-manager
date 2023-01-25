const remoteData = require('../modules/remote-data');
const { jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovData = require('../modules/tarkov-data');
const jobOutput = require('../modules/job-output');

let allItems = false;
let bsgData = false;

const isCategory = (item, categoryId) => {
    let category = item._parent;
    while (category) {
        if (category === categoryId) return true;
        category = bsgData[category]._parent;
    }
    return false;
};

const categoryMap = {
    '5485a8684bdc2da71d8b4567': {
        types: ['ammo'],
    },
    '543be5cb4bdc2deb348b4568': {
        types: ['ammo-box'],
    },
    '5448e54d4bdc2dcc718b4568': {
        types: ['armor', 'wearable']
    },
    '5448e53e4bdc2d60728b4567': {
        types: ['backpack']
    },
    '5448eb774bdc2d0a728b4567': {
        types: ['barter']
    },
    '5795f317245977243854e041': {
        types: ['container']
    },
    '567143bf4bdc2d1a0f8b4567': {
        types: ['container']
    },
    '5448e5724bdc2ddf718b4568': {
        types: ['glasses', 'wearable']
    },
    '543be6564bdc2df4348b4568': {
        types: ['grenade']
    },
    '5422acb9af1c889c16000029': {
        types: ['gun']
    },
    '5645bcb74bdc2ded0b8b4578': {
        types: ['headphones', 'wearable']
    },
    '5448f3a64bdc2d60728b456a': {
        types: ['injectors']
    },
    '543be5e94bdc2df1348b4568': {
        types: ['keys']
    },
    '543be5664bdc2dd4348b4569': {
        types: ['meds', 'provisions']
    },
    '5448fe124bdc2da5018b4567': {
        types: ['mods']
    },
    '55818a684bdc2ddd698b456d': {
        types: ['pistol-grip']
    },
    '543be6674bdc2df1348b4569': {
        types: ['provisions']
    },
    '5448e5284bdc2dcb718b4567': {
        types: ['rig', 'wearable'],
        always: async itemId => {
            if (bsgData[itemId]._props.armorClass && !allItems.get(itemId).types.includes('armor')) {
                await remoteData.addType(itemId, 'armor').then(results => {
                    if (results.affectedRows == 0) {
                        logger.fail(`Already marked as armor ${itemId} ${allItems.get(itemId).name}`);
                    }
                });
            }
        }
    },
    '550aa4cd4bdc2dd8348b456c': {
        types: ['suppressor']
    },
    '5a341c4086f77401f2541505': {
        types: ['wearable']
    },
    '5b3f15d486f77432d0509248': {
        types: ['wearable']
    },
    '5a341c4686f77469e155819e': {
        types: ['wearable']
    },
};

module.exports = async (externalLogger) => {
    const logger = externalLogger || new JobLogger('update-types');
    try {
        allItems = await remoteData.get();
        bsgData = await tarkovData.items();
        const presets = await jobOutput('update-presets', './cache/presets.json', logger);

        logger.log(`Updating types`);
        for (const [itemId, item] of allItems.entries()) {
            if (presets[item.id]) {
                if (!item.types.includes('preset')) {
                    logger.warn(`${itemId} ${item.name} is not marked as a preset`);
                    await remoteData.addType(itemId, 'preset').then(results => {
                        if (results.affectedRows == 0) {
                            logger.fail(`Already marked as preset ${itemId} ${item.name}`);
                        }
                    });
                }
                continue;
            }
            //logger.log(`Checking ${itemId} ${item.name}`)
            if (item.types.includes('preset')) {
                continue;
            }
            try {
                if (!bsgData[itemId]) {
                    if (!item.types.includes('disabled')) {
                        logger.warn(`${itemId} ${item.name} is no longer in the game, disabling`);
                        await remoteData.addType(itemId, 'disabled').then(results => {
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

                    await remoteData.removeType(itemId, 'no-flea').then(results => {
                        if (results.affectedRows == 0) {
                            logger.fail(`Not marked as no-flea ${itemId} ${item.name}`);
                        }
                    });
                } else if(!item.types.includes('no-flea') && !bsgData[itemId]._props.CanSellOnRagfair){
                    logger.warn(`You can't sell ${itemId} ${item.name} on flea`);
        
                    await remoteData.addType(itemId, 'no-flea').then(results => {
                        if (results.affectedRows == 0) {
                            logger.fail(`Already marked as no-flea ${itemId} ${item.name}`);
                        }
                    });
                }
                if (!item.types.includes('quest') && bsgData[itemId]._props.QuestItem) {
                    logger.warn(`${itemId} ${item.name} is not marked as a quest item`);
                    await remoteData.addType(itemId, 'quest').then(results => {
                        if (results.affectedRows == 0) {
                            logger.fail(`Already marked as quest item ${itemId} ${item.name}`);
                        }
                    });
                }
                for (const categoryId in categoryMap) {
                    if (!isCategory(bsgData[itemId], categoryId)) continue;
                    for (const type of categoryMap[categoryId].types) {
                        if (item.types.includes(type)) continue;
                        logger.warn(`Assigning ${itemId} ${item.name} ${type} type`);
        
                        await remoteData.addType(itemId, type).then(results => {
                            if (results.affectedRows == 0) {
                                logger.fail(`Already marked as ${type} ${itemId} ${item.name}`);
                            }
                        });
                    }
                    if (categoryMap[categoryId].always) await categoryMap[categoryId].always(itemId);
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