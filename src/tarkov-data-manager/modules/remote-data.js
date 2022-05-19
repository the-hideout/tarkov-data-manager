const midmean = require('compute-midmean');

const {categories, items} = require('../modules/category-map');
const timer = require('./console-timer');

const {query} = require('./db-connection');
const tarkovChanges = require('../modules/tarkov-changes');
const dataMaps = require('../modules/data-map');

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
            console.time('item-properties-query');
            const propertiesPromise = query(`
                SELECT
                    item_id,
                    property_key,
                    property_value
                FROM
                    item_properties`
            ).then(rows => {
                console.timeEnd('item-properties-query');
                return rows;
            });

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

            const translationsTimer = timer('translations-query');
            const translationPromise = query(`
                SELECT 
                    item_id, 
                    type, 
                    value 
                FROM 
                    translations 
                WHERE 
                    language_code = ?
            `, ['en']).then(rows => {
                translationsTimer.end();
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
            const allResults = await Promise.all([propertiesPromise, resultsPromise, translationPromise, pricePromise]);
            console.log(`All queries completed in ${new Date() - start}ms`);
            const allItemProperties = allResults[0];
            const results = allResults[1];
            const translationResults = allResults[2];
            const priceResults = allResults[3];

            const itemPropertiesMap = {};

            for(const itemProperty of allItemProperties){
                if(!itemPropertiesMap[itemProperty.item_id]){
                    itemPropertiesMap[itemProperty.item_id] = {};
                }

                itemPropertiesMap[itemProperty.item_id][itemProperty.property_key] = itemProperty.property_value;
            }

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
                const itemProperties = itemPropertiesMap[result.id];
                itemPrices[result.id]?.prices.sort();

                const preparedData = {
                    ...result,
                    avg24hPrice: getPercentile(itemPrices[result.id]?.prices || []),
                    low24hPrice: itemPrices[result.id]?.prices[0],
                    high24hPrice: itemPrices[result.id]?.prices[itemPrices[result.id]?.prices.length - 1],
                    updated: itemPrices[result.id]?.lastUpdated || result.last_update,
                    properties: itemProperties,
                    types: result.types?.split(',') || [],
                    traderPrices: [],
                    lastLowPrice: itemPrices[result.id]?.lastLowPrice,
                };

                // Add all translations
                for(const translationResult of translationResults){
                    if(translationResult.item_id !== result.id){
                        continue;
                    }

                    preparedData[translationResult.type] = translationResult.value;
                }

                if(!itemProperties){
                    if (result.types && !result.types.includes('disabled')) {
                        console.log(`Missing properties for ${result.id}`);
                    }
                    // console.log(result);
                    // console.log(itemProperties);
                }

                // Add trader prices
                const credits = await tarkovChanges.credits();
                const currenciesNow = {
                    'RUB': 1,
                    'USD': credits['5696686a4bdc2da3298b456a'],
                    'EUR': credits['569668774bdc2da2298b4568']
                    //'USD': Math.round(credits['5696686a4bdc2da3298b456a'] * 1.1045104510451),
                    //'EUR': Math.round(credits['569668774bdc2da2298b4568'] * 1.1530984204131)
                };
                const currencyId = dataMaps.currencyIsoId;
                const traderId = dataMaps.traderNameId;
                
                if(itemProperties && categories[itemProperties.bsgCategoryId]){
                    for(const trader of categories[itemProperties.bsgCategoryId].traders){
                        // console.log(`Suggested price for ${preparedData.name} at ${trader.name}: ${Math.floor(trader.multiplier * preparedData.base_price)}`);
                        let currency = 'RUB';
                        if (trader.name === 'Peacekeeper') currency = 'USD';
                        preparedData.traderPrices.push({
                            name: trader.name,
                            price: Math.round((trader.multiplier * preparedData.base_price) / currenciesNow[currency]),
                            currency: currency,
                            currencyItem: currencyId[currency],
                            priceRUB: Math.floor(trader.multiplier * preparedData.base_price),
                            trader: traderId[trader.name]
                        });
                    }
                } else {
                    if (result.types && !result.types.includes('disabled')) {
                        console.log(`No category for trader prices mapped for ${preparedData.name} with category id ${itemProperties?.bsgCategoryId}`);
                    }
                }

                // Map special items bought by specific vendors
                if(itemProperties && items[result.id]){
                    for(const trader of items[result.id].traders){
                        // console.log(`Suggested price for ${preparedData.name} at ${trader.name}: ${Math.floor(trader.multiplier * preparedData.base_price)}`);
                        let currency = 'RUB';
                        if (trader.name === 'Peacekeeper') currency = 'USD';
                        preparedData.traderPrices.push({
                            name: trader.name,
                            price: Math.round((trader.multiplier * preparedData.base_price) / currenciesNow[currency]),
                            currency: currency,
                            currencyItem: currencyId[currency],
                            priceRUB: Math.floor(trader.multiplier * preparedData.base_price),
                            trader: traderId[trader.name]
                        });
                    }
                }

                /*if(itemProperties && distinctList[result.id]){
                    preparedData.traderPrices = [];

                    for(const trader of distinctList[result.id].traders){
                        // console.log(`Suggested price for ${preparedData.name} at ${trader.name}: ${Math.floor(trader.multiplier * preparedData.base_price)}`);
                        let currency = 'RUB';
                        if (trader.name === 'Peacekeeper') currency = 'USD';
                        preparedData.traderPrices.push({
                            name: trader.name,
                            price: Math.round((trader.multiplier * preparedData.base_price) / currenciesNow[currency]),
                            currency: currency,
                            currencyItem: currencyId[currency],
                            priceRUB: Math.floor(trader.multiplier * preparedData.base_price),
                            trader: traderId[trader.name]
                        });
                    }
                }*/

                // if(result.id === '59faff1d86f7746c51718c9c'){
                //     preparedData.traderPrices = [{
                //         price: Math.floor(trader.multiplier * preparedData.base_price),
                //         name: 'Therapist',
                //     }];
                // }

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
    getTraderPrices: async () => {
        console.log('Loading all data');
        const allDataTimer = timer('item-data-query');
        const items = await query(`
            SELECT
                item_data.*,
                GROUP_CONCAT(DISTINCT types.type SEPARATOR ',') AS types
            FROM
                item_data
            LEFT JOIN types ON
                types.item_id = item_data.id
            GROUP BY
                item_data.id
        `);
        allDataTimer.end();
        const translationsTimer = timer('translations');
        const translations = await query(`
            SELECT item_id, type, value
            FROM translations
            WHERE language_code = 'en' AND (type = 'name' OR type = 'shortName')
        `);
        translationsTimer.end();
        const pricesTimer = timer('trader-prices');
        const prices = await query(`
            SELECT trader_items.id, trader_items.trader_name, trader_items.currency, trader_items.min_level, trader_items.quest_unlock_id, trader_items.item_id,
                price_data.trade_id, price_data.id as price_id, price_data.price, price_data.source, price_data.timestamp
            FROM
                trader_items
            LEFT JOIN (
                SELECT p1.id, p1.price, p1.source, p1.timestamp, p1.trade_id
                FROM trader_price_data p1
                WHERE p1.timestamp = (
                    SELECT MAX(p2.timestamp)
                    FROM trader_price_data p2
                    WHERE p2.trade_id = p1.trade_id
                )
            ) price_data
            ON trader_items.id = price_data.trade_id
        `);
        pricesTimer.end();
        const returnData = new Map();
        for(const item of items){
            for(const translationResult of translations){
                if(translationResult.item_id !== item.id){
                    continue;
                }

                item[translationResult.type] = translationResult.value;
            }
            item.prices = [];
            for (const priceResult of prices) {
                if (priceResult.item_id !== item.id) {
                    continue;
                }
                item.prices.push(priceResult);
            }
            //console.log(item);
            returnData.set(item.id, item);
        }
        return returnData;
    }
};

module.exports = methods;