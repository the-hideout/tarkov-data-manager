import DataJob from '../modules/data-job.mjs';
import spApi from '../modules/sp-data.mjs';
import db from '../modules/db-connection.mjs';
import remoteData from '../modules/remote-data.mjs';
import scannerApi from '../modules/scanner-api.mjs';

class UpdateSummaryPricesJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-summary-prices'});
    }

    async run() {
        const scannerUserName = 'razzmatazz';
        const scannerName = 'sp-prices';
        const gameMode = 'regular';
        const [
            summaryPrices,
            lastPrices,
            items,
            scannerOptions,
        ] = await Promise.all([
            spApi.getAllSummaryPrices('regular'),
            db.query(`
                SELECT
                    a.item_id,
                    a.price_min as price,
                    a.price_avg as avg,
                    timestamp,
                    a.game_mode
                FROM
                    price_historical a
                INNER JOIN (
                    SELECT
                        MAX(timestamp) AS max_timestamp,
                        item_id,
                        game_mode
                    FROM 
                        price_historical
                    WHERE
                        game_mode=?
                    GROUP BY
                        item_id, game_mode
                ) b
                ON
                    a.item_id = b.item_id AND a.timestamp = b.max_timestamp AND a.game_mode = b.game_mode
            `, [0]).then(results => {
                return results.reduce((all, current) => {
                    all[current.item_id] = current;
                    return all;
                }, {});
            }),
            remoteData.get(),
            scannerApi.getUsers().then(users => {
                const user = users[scannerUserName];
                return scannerApi.getScanner({user, scannerName}, true).then(scanner => {
                    return {
                        user,
                        scannerName,
                        scanner,
                        sessionMode: gameMode,
                        offersFrom: 2,
                    };
                });
            }),
        ]);
        this.logger.log(`Retrieved ${summaryPrices.length} summary prices`);
        let newPrices = 0;
        let newScanned = 0;
        for (const price of summaryPrices) {
            const item = items.get(price.tarkov_id);
            if (!item) {
                // we don't have this item
                continue;
            }
            const lastPrice = lastPrices[price.tarkov_id];
            if (!lastPrice) {
                continue;
            }
            const options = {
                ...scannerOptions,
                itemId: item.id,
            };
            const lastPriceTimestamp = Math.max(
                lastPrice?.timestamp?.getTime() ?? 0,
                item.lastScan?.getTime() ?? 0,
            );
            const lastPriceDate = new Date(lastPriceTimestamp);
            const summaryPriceDate = new Date(price.timestamp);
            /*console.log('summary price', price);
            console.log('summary price date', summaryPriceDate);
            console.log('lastPrice', lastPrice.timestamp);
            console.log('item lastScan', item.lastScan);*/
            if (lastPriceDate < summaryPriceDate) {
                options.timestamp = summaryPriceDate;
                // price data is new
                if (price.min_price) {
                    // insert new price
                    this.logger.log(`${item.name} ${item.id} New prices: ${price.min_price}, ${price.avg_price}`);
                    newPrices++;
                    options.min = price.min_price;
                    options.avg = price.avg_price;
                    scannerApi.insertSummaryPrices(options).catch(error => {
                        this.addJobSummary(`${item.name} ${item.id}: ${error.message}`, 'Price Insert Error');
                        this.logger.log(`Error inserting ${item.name} ${item.id} summary prices: ${error.message}`);
                    });
                } else {
                    // set item scanned
                    this.logger.log(`${item.name} ${item.id} scanned`);
                    newScanned++;
                    options.scanned = true;
                    scannerApi.releaseItem(options).catch(error => {
                        this.addJobSummary(`${item.name} ${item.id}: ${error.message}`, 'Set Scanned Error');
                        this.logger.log(`Error setting ${item.name} ${item.id} scanned: ${error.message}`);
                    });
                }
            }
        }
        this.logger.log(`Inserted ${newPrices} new prices and set ${newScanned} additional items as scanned`);
    }
}

export default UpdateSummaryPricesJob;
