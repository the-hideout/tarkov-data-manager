const fs = require('fs/promises');
const  path = require('path');

const DataJob = require('../modules/data-job');

class UpdateHistoricalPricesJob extends DataJob {
    constructor() {
        super('update-archived-prices');
        this.kvName = 'archived_price_data';
    }

    async run() {
        const hexChars = (() => {
            const hexCharacters = [];
          
            for (let i = 0; i <= 15; i++) {
                hexCharacters.push(i.toString(16));
            }
          
            return hexCharacters;
        })();
        let dateCutoff = new Date(0);
        const archivedPrices = {};
        for (const hexChar of hexChars) {
            archivedPrices[hexChar] = await fs.readFile(path.join(__dirname, '..', 'dumps', `archived_price_data_${hexChar}.json`)).then(buffer => {
                return JSON.parse(buffer).ArchivedPrices;
            }).catch(error => {
                if (error.code !== 'ENOENT') {
                    console.log(error);
                }
                this.logger.log('No archived prices found for '+hexChar);
                return {};
            });
        }
        

        // filter previously-processed prices to be within the window
        // also change the cutoff for new prices to be after the oldest price we already have
        for (const hexChar of hexChars) {
            if (!archivedPrices[hexChar]) {
                archivedPrices[hexChar] = {};
            }
            for (const itemId in archivedPrices[hexChar]) {
                archivedPrices[hexChar][itemId].forEach(oldPrice => {
                    if (oldPrice.timestamp > dateCutoff.getTime()) {
                        dateCutoff = new Date(oldPrice.timestamp);
                    }
                });
            }
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
            const hexChar = row.item_id.substring(row.item_id.length-1, row.item_id.length);
            if (!archivedPrices[hexChar][row.item_id]) {
                archivedPrices[hexChar][row.item_id] = [];
            }
            archivedPrices[hexChar][row.item_id].push({
                priceMin: row.price_min,
                price: row.price_avg,
                timestamp: row.price_date.getTime(),
            });
        }

        const uploads = [];
        for (const hexChar in archivedPrices) {
            uploads.push(this.cloudflarePut(
                {ArchivedPrices: archivedPrices[hexChar]},
                `archived_price_data_${hexChar}`
            ));
            //const fileName = path.join(__dirname, '..', 'dumps', `archived_price_data_${hexChar}.json`);
            //await fs.writeFile(fileName, JSON.stringify(archivedPrices[hexChar]));
        }
        await Promise.allSettled(uploads).then(results => {
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    continue;
                }
                this.logger.error(result.reason);
            }
        });

        this.logger.success('Done with archived prices');
        // Possibility to POST to a Discord webhook here with cron status details
        return archivedPrices;
    }
}

module.exports = UpdateHistoricalPricesJob;
