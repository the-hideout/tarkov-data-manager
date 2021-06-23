const got = require('got');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const {fromEnv} = require('@aws-sdk/credential-provider-env');
const mysql = require('mysql');
const midmean = require('compute-midmean');

const bitcoinPrice = require('./bitcoin-price');
const {categories} = require('../modules/category-map');

// a client can be shared by difference commands.
const client = new S3Client({
    region: 'eu-north-1',
    credentials: fromEnv(),
});

const connection = mysql.createConnection({
    host     : 'tarkov-tools-master-1.cluster-c1vhfeufwkpn.eu-west-1.rds.amazonaws.com',
    user     : 'desktop1',
    password : process.env.MYSQL_PASSWORD,
    database : 'tarkov_tools',
});

connection.connect();

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
        console.time('item-data-query');
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

                    console.timeEnd('item-data-query');
                    console.time('translations-query');
                    connection.query(`SELECT item_id, type, value FROM translations WHERE language_code = ?`, ['en'], (translationQueryError, translationResults) => {
                        if(translationQueryError){
                            return reject(translationQueryError);
                        }

                        console.timeEnd('translations-query');
                        console.time('price-query');

                        connection.query(`
                            SELECT
                                price,
                                item_id,
                                timestamp
                            FROM
                                price_data
                            WHERE
                                timestamp > DATE_SUB(NOW(), INTERVAL 1 DAY)`, [results.id], async (priceQueryResult, priceResults) => {
                            if(priceQueryResult){
                                return reject(priceQueryResult);
                            }

                            console.timeEnd('price-query');

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
                                const itemProperties = JSON.parse(result.properties);
                                itemPrices[result.id]?.prices.sort();

                                const preparedData = {
                                    ...result,
                                    avg24hPrice: getPercentile(itemPrices[result.id]?.prices || []),
                                    low24hPrice: itemPrices[result.id]?.prices[0],
                                    high24hPrice: itemPrices[result.id]?.prices[itemPrices[result.id]?.prices.length - 1],
                                    updated: itemPrices[result.id]?.lastUpdated,
                                    properties: itemProperties,
                                    types: result.types?.split(',') || [],
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
                                    console.log('Missing bsgCategoryId for');
                                    console.log(result);
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
                                    console.log(`Failed to find category for ${preparedData.name} with id ${itemProperties.bsgCategoryId}`);
                                }

                                if(result.id === '59faff1d86f7746c51718c9c'){
                                    // Remove Therapist price
                                    preparedData.traderPrices = preparedData.traderPrices.filter(traderPrice => traderPrice.name !== 'Therapist');

                                    preparedData.traderPrices.push({
                                        price: await bitcoinPrice(),
                                        name: 'Therapist',
                                    });
                                }

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
    update: async () => {
        const newData = await methods.get();
        const uploadParams = {
            Bucket: 'tarkov-data',
            Key: 'data.json',
            Body: JSON.stringify(Object.fromEntries(newData), null, 4),
            ContentType: 'application/json',
        };

        try {
            const data = await client.send(new PutObjectCommand(uploadParams));
            console.log('Remote JSON data updated');
        } catch (err) {
            console.log('Error', err);
        }
    },
};

module.exports = methods;