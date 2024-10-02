import fs from 'node:fs/promises';
import  path from 'node:path';

import DataJob from '../modules/data-job.mjs';

const historicalPriceDays = 7;

class UpdateHistoricalPricesJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-historical-prices'});
        this.kvName = 'historical_price_data';
        this.idSuffixLength = 1;
        this.apiType = 'historicalPricePoint';
    }

    async run() {
        this.kvData = {};
        for (const gameMode of this.gameModes) {
            this.kvData[gameMode.name] = {};
            let kvName = this.kvName;
            if (gameMode.name !== 'regular') {
                kvName += `_${gameMode.name}`;
            }
            const priceWindow = new Date(new Date().setDate(new Date().getDate() - historicalPriceDays));
            const itemPriceData = await fs.readFile(path.join(import.meta.dirname, '..', 'dumps', `${kvName}.json`)).then(buffer => {
                return JSON.parse(buffer)[this.apiType];
            }).catch(error => {
                if (error.code !== 'ENOENT') {
                    console.log(error);
                }
                this.logger.log(`Generating full ${gameMode.name} historical prices`);
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
    
            this.logger.log(`Getting ${gameMode.name} prices after ${dateCutoff}`);
    
            this.logger.time('historical-prices-query');
            const historicalPriceData = await this.batchQuery(`
                SELECT
                    item_id, timestamp, MIN(price) AS price_min, AVG(price) AS price_avg
                FROM
                    price_data
                WHERE
                    timestamp > ? AND
                    game_mode = ?
                GROUP BY item_id, timestamp
                ORDER BY timestamp, item_id
            `, [dateCutoff, gameMode.value], (batchResult, offset) => {
                if (batchResult.length === 0 && offset === 0) {
                    this.logger.log(`Retrieved no ${gameMode.name} prices`);
                } else {
                    this.logger.log(`Retrieved ${offset + batchResult.length} ${gameMode.name} prices through ${batchResult[batchResult.length-1].timestamp}${batchResult.length === this.maxQueryRows ? '...' : ''}`);
                }
            });
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
    
            this.kvData[gameMode.name][this.apiType] = itemPriceData;
            await this.cloudflarePut(this.kvData[gameMode.name], this.kvName, gameMode.name);
            this.logger.log(`Uploaded ${gameMode.name} historical prices`);
        }
        this.logger.success('Done with historical prices');
        return this.kvData;
    }
}

export default UpdateHistoricalPricesJob;
