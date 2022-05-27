const fs = require('fs');

const midmean = require('compute-midmean');

const timer = require('./console-timer');

const {query} = require('./db-connection');
const tarkovChanges = require('../modules/tarkov-changes');

let myData = false;
let lastRefresh = new Date(0);

const getPercentile = (validValues) => {
    if(validValues.length === 0){
        return 0;
    }

    if(validValues.length === 1){
        return validValues[0];
    }

    if(validValues.length === 2){
        return Math.floor((validValues[0] + validValues[1]) / 2)
    }

    const sortedValues = validValues.sort((a, b) => a - b);

    return Math.floor(midmean(sortedValues, true));

    // if(validValues[0].item_id === '59fb023c86f7746d0d4b423c'){
    //     console.log(sortedValues);
    // }

    // let sum = 0;
    // let lastPrice = 0;
    // let includedCount = 0;
    // for(const currentPrice of sortedValues){
    //     // Skip anything 10x the last value. Should skip packs
    //     if(currentPrice > lastPrice * 10 && lastPrice > 0){
    //         break;
    //     }

    //     includedCount = includedCount + 1;
    //     lastPrice = currentPrice;
    //     sum = sum + currentPrice;
    // }

    // return Math.floor(sum / includedCount);
};

const methods = {
    get: async (forceRefresh) => {
        // refresh if data hasn't been loaded, it's a forced refresh, or if it's been > 10 minutes
        if (!myData || forceRefresh || new Date() - 1000 * 60 * 10 > lastRefresh) {
            return methods.refresh();
        }
        return myData;
    },
    refresh: async () => {
        console.log('Loading all data');

        const start = new Date();
        try {
            bsgData = await tarkovChanges.items();
            const en = await tarkovChanges.locale_en();
            let presets = {};
            try {
                presets = JSON.parse(fs.readFileSync('./cache/presets.json'));
            } catch (error) {
                throw error;
                // do nothing if no presets
            }
            const allDataTimer = timer('item-data-query');
            const resultsPromise = query(`
                SELECT
                    item_data.*,
                    GROUP_CONCAT(DISTINCT types.type SEPARATOR ',') AS types
                FROM
                    item_data
                LEFT JOIN types ON
                    types.item_id = item_data.id
                GROUP BY
                    item_data.id
            `).then(rows => {
                allDataTimer.end();
                return rows;
            });
            
            const priceTimer = timer('price-query');
            const pricePromise = new Promise(async (resolve, reject) => {
                const batchSize = 100000;
                let offset = 0;
                const priceSql = `
                    SELECT
                        price,
                        item_id,
                        timestamp
                    FROM
                        price_data
                    WHERE
                        timestamp > DATE_SUB(NOW(), INTERVAL 1 DAY)
                    LIMIT ?, 100000
                `;
                try {
                    const priceResults = await query(priceSql, [offset]);
                    let moreResults = priceResults.length === 100000;
                    while (moreResults) {
                        offset += batchSize;
                        const moreData = await query(priceSql, [offset]);
                        priceResults.push(...moreData);
                        if (moreData.length < batchSize) {
                            moreResults = false;
                        }
                    }
                    priceTimer.end();
                    resolve(priceResults);
                } catch (error) {
                    reject(error);
                }
            });
            const allResults = await Promise.all([resultsPromise, pricePromise]);
            console.log(`All queries completed in ${new Date() - start}ms`);
            const results = allResults[0];
            const priceResults = allResults[1];

            const returnData = new Map();
            const itemPrices = {};

            priceResults.map((resultRow) => {
                if(!itemPrices[resultRow.item_id]){
                    itemPrices[resultRow.item_id] = {
                        lastUpdated: resultRow.timestamp,
                        prices: [],
                    };
                }

                itemPrices[resultRow.item_id].prices.push(resultRow.price);
                if(itemPrices[resultRow.item_id].lastUpdated.getTime() < resultRow.timestamp.getTime()){
                    itemPrices[resultRow.item_id].lastUpdated = resultRow.timestamp;
                    itemPrices[resultRow.item_id].lastLowPrice = resultRow.price;

                    return true;
                }

                if(itemPrices[resultRow.item_id].lastUpdated.getTime() === resultRow.timestamp.getTime()){
                    if(itemPrices[resultRow.item_id].lastLowPrice > resultRow.price){
                        itemPrices[resultRow.item_id].lastLowPrice = resultRow.price;
                    }
                }
            });

            for(const result of results){
                Reflect.deleteProperty(result, 'item_id');
                itemPrices[result.id]?.prices.sort();

                const preparedData = {
                    ...result,
                    shortName: result.short_name,
                    normalizedName: result.normalized_name,
                    avg24hPrice: getPercentile(itemPrices[result.id]?.prices || []),
                    low24hPrice: itemPrices[result.id]?.prices[0],
                    high24hPrice: itemPrices[result.id]?.prices[itemPrices[result.id]?.prices.length - 1],
                    updated: itemPrices[result.id]?.lastUpdated || result.last_update,
                    types: result.types?.split(',') || [],
                    lastLowPrice: itemPrices[result.id]?.lastLowPrice,
                };
                /*if (en.templates[result.id]) {
                    preparedData.name = en.templates[result.id].Name;
                    preparedData.shortName = en.templates[result.id].ShortName;
                } else if (presets[result.id]) {
                    preparedData.name = presets[result.id].name;
                    preparedData.shortName = presets[result.id].shortName;
                }*/

                returnData.set(result.id, preparedData);
            }

            myData = returnData;
            lastRefresh = new Date();
            return Promise.resolve(returnData);
        } catch (error) {
            return Promise.reject(error);
        }
    },
    updateTypes: async updateObject => {
        //const updateData = await methods.get();
        const currentItemData = myData.get(updateObject.id);

        if(updateObject.active === false && !currentItemData.types.includes(updateObject.type)){
            return true;
        }

        if(updateObject.active === false){
            currentItemData.types.splice(currentItemData.types.indexOf(updateObject.type), 1);
            methods.removeType(updateObject.id, updateObject.type);
        }

        if(updateObject.active === true){
            currentItemData.types.push(updateObject.type);
            methods.addType(updateObject.id, updateObject.type);
        }

        myData.set(updateObject.id, currentItemData);
    },
    addType: async (id, type) => {
        console.log(`Adding ${type} for ${id}`);
        return query(`INSERT IGNORE INTO types (item_id, type) VALUES (?, ?)`, [id, type]);
    },
    removeType: async (id, type) => {
        console.log(`Removing ${type} for ${id}`);
        return query(`DELETE FROM types WHERE item_id = ? AND type= ?`, [id, type]);
    },
    setProperty: async (id, property, value) => {
        console.log(`Setting ${property} to ${value} for ${id}`);
        const currentItemData = myData.get(id);
        currentItemData[property] = value;
        myData.set(id, currentItemData);
        return query(`UPDATE item_data SET ${property} = ? WHERE id = ?`, [value, id]);
    },
};

module.exports = methods;