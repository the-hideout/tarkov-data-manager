const fs = require('fs');

const aliases = {
    HandbookCategory: 'ItemCategory',
};

const ignoreTypes = [
    'updated',
    'data',
    'expiration',
    'ItemType',
    'LanguageCode',
];

const ignoreId = [
    'Barter',
    'HideoutModule',
    'MobInfo',
    'TraderCashOffer',
];

const typesQueries = {
    Ammo: ['ammo'],
    ArmorMaterial: ['armorMaterials'],
    Barter: ['barters'],
    Craft: ['crafts'],
    FleaMarket: ['fleaMarket'],
    HideoutStation: ['hideoutStations'],
    historicalItemPricePoint: ['historicalItemPrices'],
    Item: ['items', 'itemsByIds', 'ItemsByType', 'itemsByName', 'itemByNormalizedName', 'itemsByBsgCategory'],
    ItemCategory: ['itemCategories', 'handbookCategories'],
    Map: ['maps'],
    MobInfo: ['bosses'],
    PlayerLevel: ['playerLevels'],
    QuestItem: ['questItems'],
    ServerStatus: ['status'],
    Task: ['task', 'tasks'],
    Trader: ['traders'],
    HideoutModule: ['hideoutModules'],
    Quest: ['quests'],
    TraderResetTime: ['traderResetTimes'],
};

const linkedTypes = {
    TraderCashOffer: ['ItemPrice'],
};

function addTypePurge(purgeData, dataType, value = false) {
    const purgeName = aliases[dataType] ? aliases[dataType] : dataType;
    if (!purgeData.types[purgeName]) {
        purgeData.types[purgeName] = [];
    }
    if (ignoreId.includes(purgeName)) {
        return;
    }
    if (value) {
        purgeData.types[purgeName].push(value);
    }
}

function addQueryPurge(purgeData, dataType) {
    const queries = typesQueries[dataType];
    if (!queries) {
        return;
    }
    for (const query of queries) {
        if (!purgeData.queries.includes(query)) {
            purgeData.queries.push(query);
        }
    }
}

module.exports = async (outputFile, logger) => {
    if (!logger) {
        logger = {
            ...console,
            success: console.log,
        };
    }
    let newData = {};
    let oldData = {};

    const purgeData = {types: {}, queries: []};
    const start = new Date();
    try {
        oldData = JSON.parse(fs.readFileSync(`./dumps/${outputFile}_old.json`));
    } catch (error) {
        // do nothing
    }
    try {
        newData = JSON.parse(fs.readFileSync(`./dumps/${outputFile}.json`));
        purgeData.updated =  new Date(newData.updated);
        for (const dataType in oldData) {
            if (ignoreTypes.includes(dataType)) {
                continue;
            }
            const oldD = oldData[dataType];
            const newD = newData[dataType];
            if (!newD) {
                // data type has been removed, so purge the type and queries potentially listing this type
                //console.log('data type removed', dataType);
                addTypePurge(purgeData, dataType);
                addQueryPurge(purgeData, dataType);
                continue;
            }
            for (const key in oldD) {
                const oldValue = oldD[key];
                let newValue = Array.isArray(newD) && key < newD.length ? newD[key] : false;
                let id = false;
                if (!Array.isArray(newD)) {
                    newValue = newD[key];
                    if (typeof oldValue.id !== 'undefined') {
                        id = oldValue.id;
                    }
                }
                if (Array.isArray(oldD) && Array.isArray(newD) && typeof oldValue.id !== 'undefined') {
                    id = oldValue.id;
                    newValue = newD.find(val => val.id === id);
                }
                if (!newValue) {
                    // an item has been removed from the data, so purge this item
                    //console.log('newValue does not exist for', oldValue);
                    addTypePurge(purgeData, dataType, id);
                    continue;
                }
                if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
                    // the new item is different from the old item, so purge this item
                    //console.log('newValue !== oldValue', id, newValue, oldValue);
                    addTypePurge(purgeData, dataType, id);
                }
            }
            for (const key in newD) {
                const newValue = newD[key];
                let oldValue = Array.isArray(oldD) && key < oldD.length ? oldD[key] : false;
                let id = false;
                if (!Array.isArray(oldD)) {
                    oldValue = oldD[key];
                    if (typeof newValue.id !== 'undefined') {
                        id = newValue.id;
                    }
                }
                if (Array.isArray(oldD) && Array.isArray(newD) && typeof newValue.id !== 'undefined') {
                    id = newValue.id;
                    oldValue = oldD.find(val => val.id === id);
                }
                if (!oldValue) {
                    // a new item has been added, so purge queries potentially listing this type
                    //console.log('oldValue does not exist for', newValue);
                    addQueryPurge(purgeData, dataType);
                }
            }
        }
        for (const dataType in newData) {
            if (ignoreTypes.includes(dataType)) {
                continue;
            }
            if (!oldData[dataType]) {
                // this type has been added, purge previous instances of it
                //console.log('dataType added', dataType);
                addTypePurge(purgeData, dataType);
                addQueryPurge(purgeData, dataType);
            }
        }
        for (const dataType in purgeData.types) {
            if (linkedTypes[dataType] && !purgeData.types[linkedTypes[dataType]]) {
                purgeData.types[linkedTypes[dataType]] = [];
            }
        }
        logger.log(`${outputFile} diff generated in ${new Date() - start} ms`);
    } catch (error) {
        logger.error(`Error getting KV delta: ${error.message}`);
    }
    return purgeData;
};
