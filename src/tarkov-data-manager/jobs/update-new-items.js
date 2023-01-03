// imports new items from the game data

const normalizeName = require('../modules/normalize-name');
const remoteData = require('../modules/remote-data');
//const oldShortnames = require('../old-shortnames.json');

const { connection, query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovData = require('../modules/tarkov-data');

const ignoreMap = [
    '5447bed64bdc2d97278b4568', // AGS 30x29 mm automatic grenade launcher
    '5d52cc5ba4b9367408500062', // AGS 30x29 mm automatic grenade launcher
    '5d52d479a4b936793d58c76b', // AGS-30 30-Grenades box 30x29
    '58ac60eb86f77401897560ff', // Balaclava_dev
    '59e8936686f77467ce798647', // Balaclava_test
    '5cdeb229d7f00c000e7ce174', // NSV "Utes" 12.7x108 machine gun
    '5d53f4b7a4b936793d58c780', // PAG-17 scope
    '5cde8864d7f00c0010373be1', // 12.7x108 mm B-32
    '5d2f2ab648f03550091993ca', // 12.7x108 mm BZT-44M
    '5cffa483d7ad1a049e54ef1c', // 100 rounds belt
    '56e294cdd2720b603a8b4575', // Mystery Ranch Terraplane Backpack
    '590de52486f774226a0c24c2', // Weird machinery key
    '5e85aac65505fa48730d8af2', // patron_12,7x55_ps12
    '5f647fd3f6e4ab66c82faed6', // patron_23x75_shrapnel_10
    '5675838d4bdc2d95058b456e', // Drawer
    '602543c13fee350cd564d032', // Sorting table
    '5751961824597720a31c09ac', // (off)black keycard
];

const secureContainers = [
    '544a11ac4bdc2d470e8b456a', // alpha
    '5857a8b324597729ab0a0e7d', // beta
    '59db794186f77448bc595262', // epsilon
    '5857a8bc2459772bad15db29', // gamma
    '5c093ca986f7740a1867ab12', // kappa
    '5732ee6a24597719ae0c0281', // waist pouch
];

module.exports = async (externalLogger) => {
    const logger = externalLogger || new JobLogger('update-new-items');
    try {
        const currentItems = await remoteData.get(true);

        const bsgData = await tarkovData.items();
        const en = await tarkovData.locale('en');

        logger.log('Updating game data');

        const items = Object.values(bsgData).filter((bsgObject) => {
            if(!bsgObject._props){
                return false;
            }

            if(bsgObject._type !== 'Item'){
                return false;
            }

            if(secureContainers.includes(bsgObject._id)){
                return true;
            }

            if(ignoreMap.includes(bsgObject._id)){
                return false;
            }

            // Parent is LootContainer
            if(bsgObject._parent === '566965d44bdc2d814c8b4571'){
                return false;
            }

            // Parent is MobContainer
            // Removes all secure containers, which is why we do the above check first
            if(bsgObject._parent === '5448bf274bdc2dfc2f8b456a'){
                return false;
            }

            // Parent is Stash
            if(bsgObject._parent === '566abbb64bdc2d144c8b457d'){
                return false;
            }

            // Parent is Pockets
            if(bsgObject._parent === '557596e64bdc2dc2118b4571'){
                return false;
            }

            // Parent is Inventory
            if(bsgObject._parent === '55d720f24bdc2d88028b456d'){
                return false;
            }

            // Parent is Sorting table
            if(bsgObject._parent === '6050cac987d3f925bf016837'){
                return false;
            }

            // 5b9b9020e7ef6f5716480215 dogtagt

            // Removes shrapnel etc
            if(bsgObject._props.StackMinRandom === 0){
                return false
            }

            return true;
        });

        const doNotUse = /DO[ _]NOT[ _]USE|translation_pending/;
        for (const item of items) {
            // Skip existing items to speed things up
            if (currentItems.has(item._id)){
                continue;
            }

            let name = item._props.Name.trim();
            let shortname = '';
            name = en[`${item._id} Name`] || name;
            shortname = en[`${item._id} ShortName`] || shortname;
            name = String(name).trim();
            shortname = String(shortname).trim();
            if (name.match(doNotUse)) continue;
            const normalized = normalizeName(name);

            try {
                if (item._props.QuestItem){
                    await query(`INSERT IGNORE INTO types (item_id, type) VALUES(?, 'quest')`, [item._id]);
                }
                const results = await query(`
                    INSERT INTO 
                        item_data (id, name, short_name, normalized_name, width, height, properties)
                    VALUES (
                        '${item._id}',
                        ${connection.escape(name)},
                        ${connection.escape(shortname)},
                        ${connection.escape(normalized)},
                        ${connection.escape(item._props.Width)},
                        ${connection.escape(item._props.Height)},
                        ${connection.escape(JSON.stringify({backgroundColor: item._props.BackgroundColor}))}
                    )
                    ON DUPLICATE KEY UPDATE
                        name=${connection.escape(name)},
                        short_name=${connection.escape(name)},
                        width=${connection.escape(item._props.Width)},
                        height=${connection.escape(item._props.Height)},
                        properties=${connection.escape(JSON.stringify({backgroundColor: item._props.BackgroundColor}))}
                `);
                if (results.changedRows > 0){
                    console.log(`${name} updated`);
                }

                if(results.insertId !== 0){
                    console.log(`${name} added`);
                }
            } catch (error){
                logger.fail(`${name} error updating item`);
                logger.error(error);
                logger.end();
                jobComplete();
                return Promise.reject(error);
            }
        }

        for (const itemId in currentItems.keys()){
            if (items.find(bsgItem => bsgItem._id === itemId)){
                continue;
            }
            if (currentItems.get(itemId).types.includes('disabled')) {
                continue;
            }
            if (currentItems.get(itemId).types.includes('preset')) {
                continue;
            }
            logger.warn(`${currentItems.get(itemId).name} (${currentItems.get(itemId).id}) is no longer available in the game`);
        }

        logger.succeed('Game data update complete');
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