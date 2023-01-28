const fs = require('fs/promises');
const  path = require('path');

const { query } = require('../modules/db-connection');
const DataJob = require('../modules/data-job');

class UpdateHistoricalPricesJob extends DataJob {
    constructor() {
        super('update-historical-prices');
        this.kvName = 'historical_price_data';
    }

    async run() {
        const aWeekAgo = new Date();
        aWeekAgo.setDate(aWeekAgo.getDate() - 7);
        const itemPriceData = await fs.readFile(path.join(__dirname, '..', 'dumps', 'historical_price_data.json')).then(buffer => {
            const parsed = JSON.parse(buffer);
            return parsed.historicalPricePoint || parsed.data;
        }).catch(error => {
            if (error.code !== 'ENOENT') {
                console.log(error);
            }
            return {};
        });
        let lastTimestamp = 0;
        for (const itemId in itemPriceData) {
            itemPriceData[itemId] = itemPriceData[itemId].filter(oldPrice => {
                if (oldPrice.timestamp > lastTimestamp) {
                    lastTimestamp = oldPrice.timestamp;
                }
                return oldPrice.timestamp > aWeekAgo;
            });
        }
        const dateCutoff = lastTimestamp ? new Date(lastTimestamp) : aWeekAgo;
        
        const allPriceData = {};

        this.logger.time(`historical-price-query-items`);
        const historicalPriceDataItemIds = await query(`SELECT
            item_id
        FROM
            price_data
        WHERE
            timestamp > ?
        GROUP BY
            item_id`, [dateCutoff]);
        this.logger.timeEnd(`historical-price-query-items`);

        this.logger.time('all-items-queries');
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
                item_id = ?`, [dateCutoff, itemId]
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
        this.logger.timeEnd('all-items-queries');

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
        const priceData = {
            historicalPricePoint: itemPriceData
        };

        await this.cloudflarePut(priceData);

        this.logger.success('Done with historical prices');
        // Possibility to POST to a Discord webhook here with cron status details
        return priceData;
    }
}

module.exports = UpdateHistoricalPricesJob;
