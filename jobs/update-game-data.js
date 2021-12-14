const normalizeName = require('../modules/normalize-name');
const {categories} = require('../modules/category-map');
const presetSize = require('../modules/preset-size');
const ttData = require('../modules/tt-data');
const oldShortnames = require('../old-shortnames.json');

const bsgData = require('../bsg-data.json');

const connection = require('../modules/db-connection');

const mappingProperties = [
    'BlindnessProtection',
    'MaxDurability',
    'armorClass',
    'speedPenaltyPercent',
    'mousePenalty',
    'weaponErgonomicPenalty',
    'armorZone',
    'ArmorMaterial',
    'headSegments',
    'BlocksEarpiece',
    'DeafStrength',
    'RicochetParams',
    'Accuracy',
    'Recoil',
    'Ergonomics',
    'Weight',
];

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

const INSERT_KEYS = [
    'name',
    'shortName',
    'description',
];

const getGrid = (item) => {
    if(!item._props.Grids){
        return false;
    }

    const gridData = {
        pockets: [],
        totalSize: 0,
    };

    for(const grid of item._props.Grids){
        gridData.totalSize = gridData.totalSize + grid._props.cellsH * grid._props.cellsV;
        gridData.pockets.push({
            height: grid._props.cellsH,
            width: grid._props.cellsV
        });
    }

    return gridData;
};

const getItemCategory = (item) => {
    if(!item){
        return false;
    }

    if(!item._parent){
        return false;
    }

    // Check if parent is category
    if(categories[item._parent]){
        return categories[item._parent];
    }

    // Let's traverse
    return getItemCategory(bsgData[item._parent]);
};

const getItemCategories = (item, previousCategories = []) => {
    if(!item){
        return previousCategories;
    }

    if(!item._parent){
        return previousCategories;
    }

    // // Check if parent is category
    // if(categories[item._parent]){
    //     return ;
    // }

    // Let's traverse
    // return previousCategories.concat([bsgData[item._parent]]);
    return previousCategories.concat(getItemCategories(bsgData[item._parent], [bsgData[item._parent]]));
};

module.exports = async () => {
    const allTTItems = await ttData();

    const items = Object.values(bsgData).filter((bsgObject) => {
        if(bsgObject._type !== 'Item'){
            return false;
        }

        if(bsgObject._props.QuestItem){
            return false;
        }

        if(bsgObject._id === '5732ee6a24597719ae0c0281'){
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
        // Removes all secure containers tho...
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

    for(let i = 0; i < items.length; i = i + 1){
        const item = items[i];
        console.log(`Updating ${i + 1}/${items.length} ${item._id} ${item._props.ShortName}`);
        const extraProperties = {};
        for(const extraProp of mappingProperties){

            if(!item._props[extraProp]){
                continue;
            }

            extraProperties[extraProp] = item._props[extraProp];
        }

        extraProperties.grid = getGrid(item);

        const itemCategory = getItemCategory(item);

        extraProperties.bsgCategoryId = itemCategory?.id || item._parent;

        item.name = item._props.Name.toString();
        item.shortName = item._props.ShortName.toString();
        item.description = item._props.Description.toString();
        item.width = item._props.Width;
        item.height = item._props.Height;

        let itemPresetSize = await presetSize(item.shortName, item._id);

        if(!itemPresetSize && oldShortnames[item._id]){
            itemPresetSize = await presetSize(oldShortnames[item._id], item._id);
        }

        if(itemPresetSize){
            item.width = itemPresetSize.width;
            item.height = itemPresetSize.height;
        }

        if(!allTTItems[item._id]){
            console.log(`New item: ${item.name}`);
        }

        const promise = new Promise((resolve, reject) => {
            connection.query(`INSERT INTO item_data (id, normalized_name, base_price, width, height, properties)
                VALUES (
                    '${item._id}',
                    ${connection.escape(normalizeName(item._props.Name))},
                    ${item._props.CreditsPrice},
                    ${item.width},
                    ${item.height},
                    ${connection.escape(JSON.stringify(extraProperties))}
                )
                ON DUPLICATE KEY UPDATE
                    normalized_name=${connection.escape(normalizeName(item._props.Name))},
                    base_price=${item._props.CreditsPrice},
                    width=${item.width},
                    height=${item.height},
                    properties=${connection.escape(JSON.stringify(extraProperties))}`
                , async (error, results) => {
                    if (error) {
                        reject(error)
                    }

                    if(results.changedRows > 0){
                        console.log(`${item._props.Name} updated`);
                    }

                    if(results.insertId !== 0){
                        console.log(`${item._props.Name} added`);
                    }

                    for(const insertKey of INSERT_KEYS){
                        const promise = new Promise((translationResolve, translationReject) => {
                            connection.query(`INSERT IGNORE INTO translations (item_id, type, language_code, value)
                                VALUES (
                                    ?,
                                    ?,
                                    ?,
                                    ?
                                )`, [item._id, insertKey.toLowerCase(), 'en', item[insertKey].trim()], (error) => {
                                    if (error) {
                                        translationReject(error);
                                    }

                                    translationResolve();
                                }
                            );
                        });

                        try {
                            await promise;
                        } catch (upsertError){
                            console.error(upsertError);

                            throw upsertError;
                        }

                    }

                    resolve();
                }
            );
        });

        try {
            await promise;
        } catch (upsertError){
            console.error(upsertError);

            throw upsertError;
        }
    }

    for(const ttItemId in allTTItems){
        if(items.find(bsgItem => bsgItem._id === ttItemId)){
            continue;
        }

        console.error(`${allTTItems[ttItemId].name} is no longer available in the game`);
        await new Promise((resolve, reject) => {
            connection.query(`UPDATE item_data SET disabled = 1 WHERE id = ?`, [ttItemId], async (error, results) => {
                    if (error) {
                        reject(error)
                    }

                    resolve();
                }
            );
        });
    }
};