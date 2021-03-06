const cloudflare = require('../modules/cloudflare');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

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
        }

        const response = await cloudflare.put('historical_price_data', JSON.stringify({
            updated: new Date(),
            data: itemPriceData,
        })).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of historical_price_data');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                logger.error(response.messages[i]);
            }
        }

        logger.success('Done with historical prices');
        // Possibility to POST to a Discord webhook here with cron status details
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
    await jobComplete();
};