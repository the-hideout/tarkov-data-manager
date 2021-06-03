require('dotenv').config();

const mysql = require('mysql');
const roundTo = require('round-to');

const cloudflare = require('../modules/cloudflare');
const remoteData = require('../modules/remote-data');

const connection = mysql.createConnection({
    host     : 'tarkov-tools-master-1.cluster-c1vhfeufwkpn.eu-west-1.rds.amazonaws.com',
    user     : 'desktop1',
    password : process.env.MYSQL_PASSWORD,
    database : 'tarkov_tools',
});

connection.connect();

function replacer(key, value) {
    if(value instanceof Map) {
        return {
            dataType: 'Map',
            value: Array.from(value.entries()), // or with spread: value: [...value]
        };
    } else {
        return value;
    }
}

async function doQuery(query) {
    let responseData;
    const promise = new Promise((resolve, reject) => {
        connection.query(query
            , async (error, results) => {
                if (error) {
                    reject(error)
                }

                resolve(results);
            }
        );
    });

    try {
        responseData = await promise;
    } catch (upsertError){
        console.error(upsertError);

        throw upsertError;
    }

    return responseData;
}

module.exports = async () => {
    console.log('Running cache update');
    const itemMap = await remoteData.get();
    const itemData = {};

    const avgPriceYesterday = await doQuery(`SELECT
    avg(price) AS priceYesterday,
    item_id,
    timestamp
FROM
    price_data
WHERE
    timestamp > DATE_SUB(NOW(), INTERVAL 2 DAY)
AND
    timestamp < DATE_SUB(NOW(), INTERVAL 1 DAY)
GROUP BY
    item_id`);

    connection.end();

    for (const [key, value] of itemMap.entries()) {
        itemData[key] = value;

        Reflect.deleteProperty(itemData[key], 'last_update');
        Reflect.deleteProperty(itemData[key], 'last_scan');
        Reflect.deleteProperty(itemData[key], 'checked_out_by');
        Reflect.deleteProperty(itemData[key], 'trader_last_scan');
        Reflect.deleteProperty(itemData[key], 'trader_checked_out_by');

        let itemPriceYesterday = avgPriceYesterday.find(row => row.item_id === key);
        if(!itemPriceYesterday || itemData[key].avg24hPrice === 0){
            itemData[key].changeLast24h = 0;

            continue;
        }

        itemData[key].changeLast24h = roundTo((1 - itemPriceYesterday.priceYesterday / itemData[key].avg24hPrice) * 100, 2);
    }

    try {
        const response = await cloudflare(`accounts/66766e138fce1ac1d2ef95953e037f4e/storage/kv/namespaces/f04e5b75ee894b3a90cec2b7cc351311/values/ITEM_CACHE`, 'PUT', JSON.stringify(itemData));
        console.log(response);
    } catch (requestError){
        console.error(requestError);
    }
};