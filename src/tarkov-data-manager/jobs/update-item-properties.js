const objectPath = require('object-path');

const ttData = require('../modules/tt-data');
const {query, jobComplete} = require('../modules/db-connection');
const {categories} = require('../modules/category-map');

const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');

let logger = false;

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

const updateProperty = async (itemId, propertyKey, propertyValue) => {
    let shouldUpdate = true;
    try {
        const results = await query(`
            INSERT IGNORE INTO 
                item_properties (item_id, property_key, property_value)
            VALUES 
                (?, ?, ?)
            `, [
                itemId,
                propertyKey,
                propertyValue,
                propertyKey,
                propertyValue
            ]
        );
        if(results.insertId !== 0){
            shouldUpdate = false;
        }
    } catch (error){
        logger.error(error);
        logger.end();

        return Promise.reject(error);
    }

    if(!shouldUpdate){
        return true;
    }

    try {
        const results = await query(`
            UPDATE 
                item_properties 
            SET 
                property_key = ?, property_value = ?
            WHERE
                item_id = ?
            AND
                property_key = ?
        `, [
            propertyKey,
            propertyValue,
            itemId,
            propertyKey,
        ]);
    } catch (error){
        logger.error(error);
        logger.end();
        return Promise.reject(error);
    }
}

const mappingProperties = {
    // 'BlindnessProtection',
    // 'speedPenaltyPercent',
    // 'mousePenalty',
    // 'weaponErgonomicPenalty',
    // 'armorZone',
    // 'ArmorMaterial',
    // 'headSegments',
    // 'BlocksEarpiece',
    // 'DeafStrength',
    '_props.MaxDurability': 'maxDurability',
    '_props.armorClass': 'armorClass',
    '_props.Accuracy': 'accuracy',
    '_props.Recoil': 'recoil',
    '_props.Ergonomics': 'ergonomics',
    '_props.Weight': 'weight',
    '_props.Caliber': 'caliber',
    '_props.StackMaxSize': 'stackMaxSize',
    '_props.Tracer': 'tracer',
    '_props.TracerColor': 'tracerColor',
    '_props.ammoType': 'ammoType',
    '_props.ProjectileCount': 'projectileCount',
    '_props.Damage': 'damage',
    '_props.ArmorDamage': 'armorDamage',
    '_props.FragmentationChance': 'fragmentationChance',
    '_props.RicochetChance': 'ricochetChance',
    '_props.PenetrationChance': 'penetrationChance',
    '_props.PenetrationPower': 'penetrationPower',
    '_props.ammoAccr': 'accuracy',
    '_props.ammoRec': 'recoil',
    '_props.InitialSpee': 'initialSpeed',
    '_props.Velocity': 'velocity',
    '_props.Loudness': 'loudness',
};

module.exports = async () => {
    logger = new JobLogger('update-item-properties');
    try {
        //console.log('Running bsgData...');
        //await bsgDataHelper();
        //logger.log('Completed bsgData...');

        const allTTItems = await ttData();

        const bsgData = await tarkovChanges.items();

        const currentProperties = {};

        const results = await query(`SELECT * FROM item_properties`);

        for(const result of results){
            if(!currentProperties[result.item_id]){
                currentProperties[result.item_id] = {};
            }

            currentProperties[result.item_id][result.property_key] = result.property_value;
        }

        logger.log('Updating game data');
        const ttItems = Object.values(allTTItems);

        for(let i = 0; i < ttItems.length; i = i + 1){
            const item = ttItems[i];

            if(!bsgData[item.id]?._props){
                continue;
            }

            for(const propertyKey in mappingProperties){
                let propertyValue = objectPath.get(bsgData[item.id], propertyKey);

                // Skip falsy strings
                // Should be fixed for actual booleans
                if(typeof propertyValue === 'string' && propertyValue === '') {
                    continue;
                }

                if(typeof propertyValue === 'number' && currentProperties[item.id] && Number(currentProperties[item.id][mappingProperties[propertyKey]]) === propertyValue){
                    continue;
                }

                if(typeof propertyValue === 'undefined'){
                    continue;
                }

                if(typeof propertyValue === 'boolean' && currentProperties[item.id] && currentProperties[item.id][mappingProperties[propertyKey]] === propertyValue.toString()){
                    continue;
                }

                // Skip values we already have
                if(currentProperties[item.id] && currentProperties[item.id][mappingProperties[propertyKey]] === propertyValue){
                    continue;
                }

                logger.log(`Updating ${item.name} ${mappingProperties[propertyKey]} to ${propertyValue}`);

                // Store bools as string in db
                if(typeof propertyValue === 'boolean'){
                    propertyValue = propertyValue.toString();
                }

                await updateProperty(item.id, mappingProperties[propertyKey], propertyValue);
            }

            // const bsgCategoryId = itemCategory(bsgData[item.id]);
            const bsgCategoryId = bsgData[item.id]._parent;

            if(currentProperties[item.id] && currentProperties[item.id].bsgCategoryId === bsgCategoryId){
                continue;
            }

            logger.log(`Updating ${item.name} bsgCategoryId to ${bsgCategoryId}`);
            await updateProperty(item.id, 'bsgCategoryId', bsgCategoryId);
        }

        logger.succeed('Done with all item property updates')

        
        // Possibility to POST to a Discord webhook here with cron status details
    } catch (error){
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
    await jobComplete();
};