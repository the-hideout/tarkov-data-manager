const fs = require('fs');
const path = require('path');

const ora = require('ora');
const objectPath = require('object-path');

const ttData = require('../modules/tt-data');
const {connection} = require('../modules/db-connection');
const {categories} = require('../modules/category-map');

let bsgData;

const itemCategory = (item) => {
    const itemCategory = getItemCategory(item);

    return itemCategory?.id || item._parent;
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

const updateProperty = async (itemId, propertyKey, propertyValue) => {
    let shouldUpdate = true;
    try {
        await new Promise((resolve, reject) => {
            connection.query(`INSERT IGNORE INTO item_properties (item_id, property_key, property_value)
                VALUES (?, ?, ?)`,
                    [
                        itemId,
                        propertyKey,
                        propertyValue,
                        propertyKey,
                        propertyValue
                    ],
                async (error, results) => {
                    if (error) {
                        reject(error)
                    }

                    // We added the row, no need to update
                    if(results.insertId !== 0){
                        shouldUpdate = false;
                    }

                    resolve();
                }
            );
        });
    } catch (upsertError){
        console.error(upsertError);

        throw upsertError;
    }

    if(!shouldUpdate){
        return true;
    }

    try {
        await new Promise((resolve, reject) => {
            connection.query(`UPDATE item_properties SET property_key = ?, property_value = ?
                WHERE
                    item_id = ?
                AND
                    property_key = ?`,
                    [
                        propertyKey,
                        propertyValue,
                        itemId,
                        propertyKey,
                    ],
                async (error, results) => {
                    if (error) {
                        reject(error)
                    }

                    resolve();
                }
            );
        });
    } catch (upsertError){
        console.error(upsertError);

        throw upsertError;
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
    const allTTItems = await ttData();

    bsgData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bsg-data.json')));

    const currentProperties = await new Promise((resolve, reject) => {
        connection.query(`SELECT * FROM item_properties`,
            async (error, results) => {
                if (error) {
                    reject(error)
                }

                const currentPropertiesMap = {};

                for(const result of results){
                    if(!currentPropertiesMap[result.item_id]){
                        currentPropertiesMap[result.item_id] = {};
                    }

                    currentPropertiesMap[result.item_id][result.property_key] = result.property_value;
                }

                resolve(currentPropertiesMap);
            }
        );
    });

    const spinner = ora('Updating game data').start();
    const ttItems = Object.values(allTTItems);

    for(let i = 0; i < ttItems.length; i = i + 1){
        const item = ttItems[i];

        if(!bsgData[item.id]?._props){
            continue;
        }

        for(const propertyKey in mappingProperties){
            spinner.start(`Updating ${i + 1}/${ttItems.length} ${item.id} ${item.shortName} ${mappingProperties[propertyKey]}`);
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

            spinner.info(`Updating ${item.name} ${mappingProperties[propertyKey]} to ${propertyValue}`);

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

        spinner.info(`Updating ${item.name} bsgCategoryId to ${bsgCategoryId}`);
        await updateProperty(item.id, 'bsgCategoryId', bsgCategoryId);
    }

    spinner.succeed('Done with all item property updates')

    spinner.stop();
};