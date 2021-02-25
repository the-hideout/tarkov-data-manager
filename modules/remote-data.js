const got = require('got');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const {fromEnv} = require('@aws-sdk/credential-provider-env');
const mysql = require('mysql');

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

    const sortedValues = validValues.map(validValue => validValue.price).sort((a, b) => a - b);

    let sum = 0;
    let lastPrice = 0;
    let includedCount = 0;
    for(const currentPrice of sortedValues){
        // Skip anything 10x the last value. Should skip packs
        if(currentPrice > lastPrice * 10 && lastPrice > 0){
            break;
        }

        includedCount = includedCount + 1;
        lastPrice = currentPrice;
        sum = sum + currentPrice;
    }

    return Math.floor(sum / includedCount);
};

const methods = {
    get: async () => {
        console.log('Loading all data');
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

                    connection.query(`SELECT item_id, type, value FROM translations WHERE language_code = ?`, ['en'], (translationQueryError, translationResults) => {
                        if(translationQueryError){
                            return reject(translationQueryError);
                        }

                        connection.query(`
                            SELECT
                                price,
                                item_id,
                                timestamp
                            FROM
                                price_data
                            WHERE
                                timestamp > DATE_SUB(NOW(), INTERVAL 1 DAY)`, [results.id], (priceQueryResult, priceResults) => {
                            if(priceQueryResult){
                                return reject(priceQueryResult);
                            }

                            const returnData = new Map();

                            for(const result of results){
                                Reflect.deleteProperty(result, 'item_id');

                                const preparedData = {
                                    ...result,
                                    avg24hPrice: getPercentile(priceResults.filter(resultRow => resultRow.item_id === result.id)),
                                    properties: JSON.parse(result.properties),
                                    types: result.types?.split(',') || [],
                                }

                                for(const translationResult of translationResults){
                                    if(translationResult.item_id !== result.id){
                                        continue;
                                    }

                                    preparedData[translationResult.type] = translationResult.value;
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