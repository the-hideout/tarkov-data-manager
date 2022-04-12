const fs = require('fs');
const path = require('path');

const cloudflare = require('../modules/cloudflare');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');

module.exports = async () => {
    const logger = new JobLogger('update-historical-prices');
    try {
        const aWeekAgo = new Date();
        const allPriceData = {};
        const itemPriceData = {};

        aWeekAgo.setDate(aWeekAgo.getDate() - 7);

        logger.time(`historical-price-query-items`);
        const historicalPriceDataItemIds = await query(`SELECT
            item_id
        FROM
            price_data
        WHERE
            timestamp > ?
        GROUP BY
            item_id`, [aWeekAgo]);
        logger.timeEnd(`historical-price-query-items`);

        logger.time('all-items-queries');
        const itemQueries = [];
        for (const itemIdRow of historicalPriceDataItemIds) {
            const itemId = itemIdRow.item_id;
            if(!allPriceData[itemId]){
                allPriceData[itemId] = [];
            }

            //console.time(`historical-price-query-${itemId}`);
            const historicalPriceDataPromise = query(`SELECT
                item_id, price, timestamp
            FROM
                price_data
            WHERE
                timestamp > ?
            AND
                item_id = ?`, [aWeekAgo, itemId]
            ).then(historicalPriceData => {
                //console.timeEnd(`historical-price-query-${itemId}`);
                for (const row of historicalPriceData) {
                    if(!allPriceData[row.item_id][row.timestamp.getTime()]){
                        allPriceData[row.item_id][row.timestamp.getTime()] = {
                            sum: 0,
                            count: 0,
                        };
                    }

                    allPriceData[row.item_id][row.timestamp.getTime()].sum = allPriceData[row.item_id][row.timestamp.getTime()].sum + row.price;
                    allPriceData[row.item_id][row.timestamp.getTime()].count = allPriceData[row.item_id][row.timestamp.getTime()].count + 1;
                }
            });
            itemQueries.push(historicalPriceDataPromise);
        }
        await Promise.all(itemQueries);
        logger.timeEnd('all-items-queries');

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

        const response = await cloudflare(
            `/bulk`,
            'PUT',
            JSON.stringify(cloudflareData),
            {
                'content-type': 'application/json',
            }
        ).catch(error => {
            logger.error(error);
            return {success: false, messages: [], errors: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of /bulk');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                logger.error(response.messages[i]);
            }
        }

        fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'historical-prices.json'), JSON.stringify(cloudflareData, null, 4));
        logger.success('Done with historical prices');
        // Possibility to POST to a Discord webhook here with cron status details
    } catch (error) {
        logger.error(error);
    }
    logger.end();
    await jobComplete();
};