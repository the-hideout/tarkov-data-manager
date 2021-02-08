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

module.exports = {
    get: async () => {
        return new Promise((resolve, reject) => {
            connection.query(`
            SELECT
                item_data.*,
                GROUP_CONCAT(DISTINCT types.type SEPARATOR ',') AS types,
                AVG(price_data.price) AS avg24Price
            FROM
                item_data
            LEFT JOIN price_data ON
                price_data.item_id = item_data.id
            AND
                price_data.timestamp > DATE_SUB(NOW(), INTERVAL 1 DAY)
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
                        const returnData = new Map();

                        for(const result of results){
                            Reflect.deleteProperty(result, 'item_id');

                            const preparedData = {
                                ...result,
                                avg24Price: Math.floor(result.avg24Price),
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
                    })

                });
        });
        // const {force} = getOpts || {};
        // if(cachedData && !force){
        //     console.log('Remote data loaded from cache');
        //     return cachedData;
        // }

        // try {
        //     const remoteDataResponse = await got('https://tarkov-data.s3.eu-north-1.amazonaws.com/data.json', {
        //         responseType: 'json',
        //     });
        //     console.log('Loaded remote data');
        //     cachedData = remoteDataResponse.body;
        // } catch (gotError){
        //     console.error(gotError);

        //     return false;
        // }

        // return cachedData;
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
    update: async (newData) => {
        const uploadParams = {
            Bucket: 'tarkov-data',
            Key: 'data.json',
            Body: JSON.stringify(newData, null, 4),
            ContentType: 'application/json',
        };

        try {
            const data = await client.send(new PutObjectCommand(uploadParams));
            console.log('Remote data updated');
        } catch (err) {
            console.log('Error', err);
        }
    },
};