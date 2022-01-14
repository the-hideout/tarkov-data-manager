const fs = require('fs');
const path = require('path');

const cloudflare = require('../modules/cloudflare');
const doQuery = require('../modules/do-query');

module.exports = async () => {
    const aWeekAgo = new Date();
    const allPriceData = {};
    const itemPriceData = {};

    aWeekAgo.setDate(aWeekAgo.getDate() - 7);

    console.time('historical-price-query');
    const historicalPriceData = await doQuery(`SELECT
        item_id, price, timestamp
    FROM
        price_data
    WHERE
        timestamp > ?;`, [aWeekAgo]);
    console.timeEnd('historical-price-query');

    for (const row of historicalPriceData) {
        if(!allPriceData[row.item_id]){
            allPriceData[row.item_id] = [];
        }

        if(!allPriceData[row.item_id][row.timestamp.getTime()]){
            allPriceData[row.item_id][row.timestamp.getTime()] = {
                sum: 0,
                count: 0,
            };
        }

        allPriceData[row.item_id][row.timestamp.getTime()].sum = allPriceData[row.item_id][row.timestamp.getTime()].sum + row.price;
        allPriceData[row.item_id][row.timestamp.getTime()].count = allPriceData[row.item_id][row.timestamp.getTime()].count + 1;
    }

    let cloudflareData = [];

    for(const itemId in allPriceData){
        if(!itemPriceData[itemId]){
            itemPriceData[itemId] = [];
        }

        for(const timestamp in allPriceData[itemId]){
            itemPriceData[itemId].push({
                price: Math.floor(allPriceData[itemId][timestamp].sum / allPriceData[itemId][timestamp].count),
                timestamp: new Date().setTime(timestamp),
            });
        }

        cloudflareData.push({
            key: `historical-prices-${itemId}`,
            value: JSON.stringify(itemPriceData[itemId]),
        });
    }

    try {
        const response = await cloudflare(
            `/bulk`,
            'PUT',
            JSON.stringify(cloudflareData),
            {
                'content-type': 'application/json',
            }
        );
        console.log(response);
        // console.log(itemPriceData[itemId]);
    } catch (requestError){
        console.error(requestError);
    }
    fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'historical-prices.json'), JSON.stringify(cloudflareData, null, 4));
};