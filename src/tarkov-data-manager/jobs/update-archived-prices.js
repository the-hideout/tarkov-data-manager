const fs = require('fs/promises');
const  path = require('path');

const DataJob = require('../modules/data-job');

class UpdateArchivedPricesJob extends DataJob {
    constructor() {
        super('update-archived-prices');
        this.kvName = 'archived_price_data';
        this.idSuffixLength = 1;
        this.apiType = 'ArchivedPrices';
    }

    async run() {
        let dateCutoff = new Date(0);
        const archivedPrices = await fs.readFile(path.join(__dirname, '..', 'dumps', `archived_price_data.json`)).then(buffer => {
            return JSON.parse(buffer).ArchivedPrices;
        }).catch(error => {
            if (error.code !== 'ENOENT') {
                console.log(error);
            }
            this.logger.log('Generating full archived prices');
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

        this.logger.log(`Using query cutoff of ${dateCutoff}`);

        const batchSize = 100000;
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
                    price_date > ?
                ORDER BY price_date, item_id
                LIMIT ?, ?
            `, [dateCutoff, offset, batchSize]);
            archivedPriceData.push(...queryResults);
            if (queryResults.length > 0) {
                this.logger.log(`Retrieved ${offset + queryResults.length} prices through ${queryResults[queryResults.length-1].price_date}${queryResults.length === batchSize ? '...' : ''}`);
            } else {
                this.logger.log('Retrieved no prices');
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

        this.kvData = {};
        this.kvData[this.apiType] = archivedPrices;
        await this.cloudflarePut();

        this.logger.success('Done with archived prices');
        // Possibility to POST to a Discord webhook here with cron status details
        return this.kvData;
    }
}

module.exports = UpdateArchivedPricesJob;
