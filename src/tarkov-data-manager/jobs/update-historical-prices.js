const fs = require('fs/promises');
const  path = require('path');

const DataJob = require('../modules/data-job');

const historicalPriceDays = 7;

class UpdateHistoricalPricesJob extends DataJob {
    constructor() {
        super('update-historical-prices');
        this.kvName = 'historical_price_data';
    }

    async run() {
        const priceWindow = new Date(new Date().setDate(new Date().getDate() - historicalPriceDays));
        const itemPriceData = await fs.readFile(path.join(__dirname, '..', 'dumps', 'historical_price_data.json')).then(buffer => {
            const parsed = JSON.parse(buffer);
            return parsed.historicalPricePoint;
        }).catch(error => {
            if (error.code !== 'ENOENT') {
                console.log(error);
            }
            this.logger.log('Generating full historical prices');
            return {};
        });

        // filter previously-processed prices to be within the window
        // also change the cutoff for new prices to be after the oldest price we already have
        let dateCutoff = priceWindow;
        for (const itemId in itemPriceData) {
            itemPriceData[itemId] = itemPriceData[itemId].filter(oldPrice => {
                if (oldPrice.timestamp > dateCutoff.getTime()) {
                    dateCutoff = new Date(oldPrice.timestamp);
                }
                return oldPrice.timestamp > priceWindow.getTime();
            });
        }

        this.logger.log(`Using query cutoff of ${dateCutoff}`);

        const batchSize = 100000;
        let offset = 0;
        const historicalPriceData = [];
        this.logger.time('historical-prices-query');
        while (true) {
            const queryResults = await this.query(`
                SELECT
                    item_id, timestamp, MIN(price) AS price_min, AVG(price) AS price_avg
                FROM
                    price_data
                WHERE
                    timestamp > ?
                GROUP BY item_id, timestamp
                ORDER BY timestamp, item_id
                LIMIT ?, ?
            `, [dateCutoff, offset, batchSize]);
            historicalPriceData.push(...queryResults);
            this.logger.log(`Retrieved ${offset + queryResults.length} prices through ${queryResults[queryResults.length-1].timestamp}${queryResults.length === batchSize ? '...' : ''}`);
            if (queryResults.length !== batchSize) {
                break;
            }
            offset += batchSize;
        }
        this.logger.timeEnd('historical-prices-query');

        for (const row of historicalPriceData) {
            if (!itemPriceData[row.item_id]) {
                itemPriceData[row.item_id] = [];
            }
            itemPriceData[row.item_id].push({
                priceMin: row.price_min,
                price: Math.round(row.price_avg),
                timestamp: row.timestamp.getTime(),
            });
        }

        this.kvData = {
            historicalPricePoint: itemPriceData
        };

        await this.cloudflarePut();

        this.logger.success('Done with historical prices');
        // Possibility to POST to a Discord webhook here with cron status details
        return this.kvData;
    }
}

module.exports = UpdateHistoricalPricesJob;
