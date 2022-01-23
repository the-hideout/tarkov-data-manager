const got = require('got');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const {fromEnv} = require('@aws-sdk/credential-provider-env');
const midmean = require('compute-midmean');

const {categories, items, distinctList} = require('../modules/category-map');
const timer = require('./console-timer');

// a client can be shared by difference commands.
const client = new S3Client({
    region: 'eu-north-1',
    credentials: fromEnv(),
});

const connection = require('./db-connection');
const doQuery = require('./do-query');

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
    get: async () => {
        console.log('Loading all data');

        console.time('item-properties-query');
        const allItemProperties = await doQuery(`SELECT
            item_id,
            property_key,
            property_value
        FROM
            item_properties`);
        console.timeEnd('item-properties-query');

        const itemPropertiesMap = {};

        for(const itemProperty of allItemProperties){
            if(!itemPropertiesMap[itemProperty.item_id]){
                itemPropertiesMap[itemProperty.item_id] = {};
            }

            itemPropertiesMap[itemProperty.item_id][itemProperty.property_key] = itemProperty.property_value;
        }

        const allDataTimer = timer('item-data-query');
        return new Promise((resolve, reject) => {
            connection.query(`
            SELECT
                item_data.*,
                GROUP_CONCAT(DISTINCT types.type SEPARATOR ',') AS types
            FROM
                item_data
            LEFT JOIN types ON
                types.item_id = item_data.id
            GROUP BY
                item_data.id`, (queryError, results) => {
                    if(queryError){
                        return reject(queryError);
                    }

                    allDataTimer.end();
                    const translationsTimer = timer('translations-query');
                    connection.query(`SELECT item_id, type, value FROM translations WHERE language_code = ?`, ['en'], (translationQueryError, translationResults) => {
                        if(translationQueryError){
                            return reject(translationQueryError);
                        }

                        translationsTimer.end();
                        const priceTimer = timer('price-query');

                        connection.query(`
                            SELECT
                                price,
                                item_id,
                                timestamp
                            FROM
                                price_data
                            WHERE
                                timestamp > DATE_SUB(NOW(), INTERVAL 1 DAY)`, async (priceQueryError, priceResults) => {
                            if(priceQueryError){
                                return reject(priceQueryError);
                            }

                            priceTimer.end();

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
                                    updated: itemPrices[result.id]?.lastUpdated || new Date(),
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
                                    console.log(`Missing properties for ${result.id}`);
                                    // console.log(result);
                                    // console.log(itemProperties);
                                }

                                // Add trader prices
                                if(itemProperties && categories[itemProperties.bsgCategoryId]){
                                    for(const trader of categories[itemProperties.bsgCategoryId].traders){
                                        // console.log(`Suggested price for ${preparedData.name} at ${trader.name}: ${Math.floor(trader.multiplier * preparedData.base_price)}`);
                                        preparedData.traderPrices.push({
                                            name: trader.name,
                                            price: Math.floor(trader.multiplier * preparedData.base_price),
                                        });
                                    }
                                } else {
                                    console.log(`No category for trader prices mapped for ${preparedData.name} with category id ${itemProperties?.bsgCategoryId}`);
                                }

                                // Map special items bought by specific vendors
                                if(itemProperties && items[result.id]){
                                    for(const trader of items[result.id].traders){
                                        // console.log(`Suggested price for ${preparedData.name} at ${trader.name}: ${Math.floor(trader.multiplier * preparedData.base_price)}`);
                                        preparedData.traderPrices.push({
                                            name: trader.name,
                                            price: Math.floor(trader.multiplier * preparedData.base_price),
                                        });
                                    }
                                }

                                if(itemProperties && distinctList[result.id]){
                                    preparedData.traderPrices = [];

                                    for(const trader of distinctList[result.id].traders){
                                        // console.log(`Suggested price for ${preparedData.name} at ${trader.name}: ${Math.floor(trader.multiplier * preparedData.base_price)}`);
                                        preparedData.traderPrices.push({
                                            name: trader.name,
                                            price: Math.floor(trader.multiplier * preparedData.base_price),
                                        });
                                    }
                                }

                                // if(result.id === '59faff1d86f7746c51718c9c'){
                                //     preparedData.traderPrices = [{
                                //         price: Math.floor(trader.multiplier * preparedData.base_price),
                                //         name: 'Therapist',
                                //     }];
                                // }

                                returnData.set(result.id, preparedData);
                            }

                            return resolve(returnData);
                        });
                    });
                });
        });
    },
    addType: async (id, type) => {
        console.log(`Adding ${type} for ${id}`);
        return new Promise((resolve, reject) => {
            connection.query(`INSERT IGNORE INTO types (item_id, type) VALUES ('${id}', '${type}')`, (queryError) => {
                    if(queryError){
                        return reject(queryError);
                    }

                    return resolve();
                });
        });
    },
    removeType: async (id, type) => {
        console.log(`Removing ${type} for ${id}`);
        return new Promise((resolve, reject) => {
            connection.query(`DELETE FROM types WHERE item_id = '${id}' AND type='${type}'`, (queryError) => {
                    if(queryError){
                        return reject(queryError);
                    }

                    return resolve();
                });
        });
    },
    setProperty: async (id, property, value) => {
        console.log(`Setting ${property} to ${value} for ${id}`);
        return new Promise((resolve, reject) => {
            connection.query(`UPDATE item_data SET ${property} = ? WHERE id = ?`, [value, id], (queryError) => {
                if(queryError){
                    return reject(queryError);
                }

                return resolve();
            });
        });
    },
    getTraderPrices: async () => {
        console.log('Loading all data');
        const allDataTimer = timer('item-data-query');
        const items = await connection.promiseQuery(`
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
        const translations = await connection.promiseQuery(`
            SELECT item_id, type, value
            FROM translations
            WHERE language_code = 'en' AND (type = 'name' OR type = 'shortName')
        `);
        translationsTimer.end();
        const pricesTimer = timer('trader-prices');
        const prices = await connection.promiseQuery(`
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