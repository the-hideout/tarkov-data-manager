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
        this.idSuffixLength = 1;
        const itemPriceData = {};
        const maxDecimalValue = parseInt('f'.padEnd(this.idSuffixLength, 'f'), 16);
        for (let i = 0; i <= maxDecimalValue; i++) {
            const hexValue = i.toString(16).padStart(this.idSuffixLength, '0');
            itemPriceData[hexValue] = {};
        }
        const priceWindow = new Date(new Date().setDate(new Date().getDate() - historicalPriceDays));
        for (const hexKey in itemPriceData) {
            itemPriceData[hexKey] = await fs.readFile(path.join(__dirname, '..', 'dumps', `historical_price_data_${hexKey}.json`)).then(buffer => {
                return JSON.parse(buffer).historicalPricePoint;
            }).catch(error => {
                if (error.code !== 'ENOENT') {
                    console.log(error);
                }
                //this.logger.log('No historical prices found for '+hexKey);
                return {};
            });
        }

        // filter previously-processed prices to be within the window
        // also change the cutoff for new prices to be after the oldest price we already have
        let dateCutoff = priceWindow;
        for (const hexKey in itemPriceData) {
            for (const itemId in itemPriceData[hexKey]) {
                itemPriceData[hexKey][itemId] = itemPriceData[hexKey][itemId].filter(oldPrice => {
                    if (oldPrice.timestamp > dateCutoff.getTime()) {
                        dateCutoff = new Date(oldPrice.timestamp);
                    }
                    return oldPrice.timestamp > priceWindow.getTime();
                });
            }
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
            if (queryResults.length > 0) {
                this.logger.log(`Retrieved ${offset + queryResults.length} prices through ${queryResults[queryResults.length-1].timestamp}${queryResults.length === batchSize ? '...' : ''}`);
            } else {
                this.logger.log('Retrieved no prices');
            }
            if (queryResults.length !== batchSize) {
                break;
            }
            offset += batchSize;
        }
        this.logger.timeEnd('historical-prices-query');

        for (const row of historicalPriceData) {
            const hexKey = this.getIdSuffix(row.item_id);
            if (!itemPriceData[hexKey][row.item_id]) {
                itemPriceData[hexKey][row.item_id] = [];
            }
            itemPriceData[hexKey][row.item_id].push({
                priceMin: row.price_min,
                price: Math.round(row.price_avg),
                timestamp: row.timestamp.getTime(),
            });
        }

        const uploads = [];
        for (const hexChar in itemPriceData) {
            uploads.push(this.cloudflarePut(
                {historicalPricePoint: itemPriceData[hexChar]},
                `historical_price_data_${hexChar}`
            ));
        }
        await Promise.allSettled(uploads).then(results => {
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    continue;
                }
                this.logger.error(result.reason);
            }
        });

        this.logger.success('Done with historical prices');
        // Possibility to POST to a Discord webhook here with cron status details
        return this.kvData;
    }

    getIdSuffix(id) {
        return id.substring(id.length-this.idSuffixLength, id.length);
    }
}

module.exports = UpdateHistoricalPricesJob;
