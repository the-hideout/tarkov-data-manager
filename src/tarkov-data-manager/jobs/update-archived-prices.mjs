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
    
            const batchSize = this.maxQueryRows;
            let offset = 0;
            const archivedPriceData = [];
            this.logger.time('archived-prices-query');
            while (true) {
                const queryResults = await this.query(`
                    SELECT
                        item_id, price_date, price_min, price_avg
                    FROM
                        price_archive
                    WHERE
                        price_date > ? AND
                        game_mode = ?
                    ORDER BY price_date, item_id
                    LIMIT ?, ?
                `, [dateCutoff, gameMode.value, offset, batchSize]);
                queryResults.forEach(r => archivedPriceData.push(r));
                if (queryResults.length > 0) {
                    this.logger.log(`Retrieved ${offset + queryResults.length} ${gameMode.name} prices through ${queryResults[queryResults.length-1].price_date}${queryResults.length === batchSize ? '...' : ''}`);
                } else {
                    this.logger.log(`Retrieved no ${gameMode.name} prices`);
                }
                if (queryResults.length !== batchSize) {
                    break;
                }
                offset += batchSize;
            }
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
