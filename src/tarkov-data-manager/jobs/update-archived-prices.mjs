import fs from 'node:fs/promises';
import path from 'node:path';

import DataJob from '../modules/data-job.mjs';

class UpdateArchivedPricesJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-archived-prices'});
        this.kvName = 'archived_price_data';
        this.idSuffixLength = 1;
        this.apiType = 'ArchivedPrices';
    }

    async run() {
        this.kvData = {};
        for (const gameMode of this.gameModes) {
            this.kvData[gameMode.name] = {};
            let kvName = this.kvName;
            if (gameMode.name !== 'regular') {
                kvName += `_${gameMode.name}`;
            }
            let dateCutoff = new Date(0);
            const archivedPrices = await fs.readFile(path.join(import.meta.dirname, '..', 'dumps', `${kvName}.json`)).then(buffer => {
                return JSON.parse(buffer).ArchivedPrices;
            }).catch(error => {
                if (error.code !== 'ENOENT') {
                    console.log(error);
                }
                this.logger.log(`Generating full archived ${gameMode.name} prices`);
                return {};
            });
            
    
            // filter previously-processed prices to be within the window
            // also change the cutoff for new prices to be after the oldest price we already have
            for (const itemId in archivedPrices) {
                archivedPrices[itemId].forEach(oldPrice => {
                    if (oldPrice.timestamp > dateCutoff.getTime()) {
                        dateCutoff = new Date(oldPrice.timestamp);
                    }
                });
            }
    
            this.logger.log(`Using ${gameMode.name} query cutoff of ${dateCutoff}`);
    
            this.logger.time('archived-prices-query');
            const archivedPriceData = await this.batchQuery(`
                SELECT
                    item_id, price_date, price_min, price_avg
                FROM
                    price_archive
                WHERE
                    price_date > ? AND
                    game_mode = ?
                ORDER BY price_date, item_id
            `, [dateCutoff, gameMode.value], (batchResults, offset) => {
                if (batchResults.length === 0 && offset === 0) {
                    this.logger.log(`Retrieved no ${gameMode.name} prices`);
                } else {
                    this.logger.log(`Retrieved ${offset + batchResults.length} ${gameMode.name} prices through ${batchResults[batchResults.length-1].price_date}${batchResults.length === this.maxQueryRows ? '...' : ''}`);
                }
            });
            this.logger.timeEnd('archived-prices-query');
    
            for (const row of archivedPriceData) {
                if (!archivedPrices[row.item_id]) {
                    archivedPrices[row.item_id] = [];
                }
                archivedPrices[row.item_id].push({
                    priceMin: row.price_min,
                    price: row.price_avg,
                    timestamp: row.price_date.getTime(),
                });
            }
    
            this.kvData[gameMode.name][this.apiType] = archivedPrices;
            await this.cloudflarePut(this.kvData[gameMode.name], this.kvName, gameMode.name);
            this.logger.log(`Uploaded ${gameMode.name} prices`);
        }

        this.logger.success('Done with archived prices');
        // Possibility to POST to a Discord webhook here with cron status details
        return this.kvData;
    }
}

export default UpdateArchivedPricesJob;
