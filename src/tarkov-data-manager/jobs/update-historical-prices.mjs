import fs from 'node:fs/promises';
import  path from 'node:path';

import DataJob from '../modules/data-job.mjs';

const historicalPriceDays = 7;

class UpdateHistoricalPricesJob extends DataJob {
    constructor() {
        super('update-historical-prices');
        this.kvName = 'historical_price_data';
        this.idSuffixLength = 1;
        this.apiType = 'historicalPricePoint';
    }

    async run() {
        this.kvData = {
            regular: {},
            pve: {},
        };
        for (let pve = 0; pve < 2; pve++) {
            let kvName = this.kvName;
            let gameMode = 'regular';
            if (pve) {
                kvName = 'historical_price_pve_data';
                gameMode = 'pve';
            }
            const priceWindow = new Date(new Date().setDate(new Date().getDate() - historicalPriceDays));
            const itemPriceData = await fs.readFile(path.join(import.meta.dirname, '..', 'dumps', `${kvName}.json`)).then(buffer => {
                return JSON.parse(buffer)[this.apiType];
            }).catch(error => {
                if (error.code !== 'ENOENT') {
                    console.log(error);
                }
                this.logger.log(`Generating full ${gameMode} historical prices`);
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
    
            this.logger.log(`Using ${gameMode} query cutoff of ${dateCutoff}`);
    
            const batchSize = this.maxQueryRows;
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
                        timestamp > ? AND
                        game_mode = ?
                    GROUP BY item_id, timestamp
                    ORDER BY timestamp, item_id
                    LIMIT ?, ?
                `, [dateCutoff, pve, offset, batchSize]);
                queryResults.forEach(r => historicalPriceData.push(r));
                if (queryResults.length > 0) {
                    this.logger.log(`Retrieved ${offset + queryResults.length} ${gameMode} prices through ${queryResults[queryResults.length-1].timestamp}${queryResults.length === batchSize ? '...' : ''}`);
                } else {
                    this.logger.log(`Retrieved no ${gameMode} prices`);
                }
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
    
            this.kvData[gameMode][this.apiType] = itemPriceData;
            await this.cloudflarePut(this.kvData[gameMode], kvName);
            this.logger.log(`Uploaded ${gameMode} historical prices`);
        }
        this.logger.success('Done with historical prices');
        return this.kvData;
    }
}

export default UpdateHistoricalPricesJob;