import DataJob from '../modules/data-job.mjs';
import spApi from '../modules/sp-data.mjs';
import db from '../modules/db-connection.mjs';
import remoteData from '../modules/remote-data.mjs';
import scannerApi from '../modules/scanner-api.mjs';
import gameModes from '../modules/game-modes.mjs';

class UpdateFleaPricesJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-flea-prices'});
    }

    async run() {
        const scannerUserName = 'razzmatazz';
        const scannerName = 'sp-prices';
        const updateGameModes = [
            'regular',
            'pve',
        ];
        for (const gameModeInfo of gameModes) {
            if (!updateGameModes.includes(gameModeInfo.name)) {
                continue;
            }
            const gameMode = gameModeInfo.name;
            const [
                latestPrices,
                lastPrices,
                items,
                scannerOptions,
            ] = await Promise.all([
                spApi.itemsOverview(gameMode),
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
                `, [gameModeInfo.value]).then(results => {
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
            this.logger.log(`Retrieved ${latestPrices.length} summary prices`);
            let newPrices = 0;
            let newScanned = 0;
            let current = 0;
            for (const itemPrice of latestPrices) {
                const item = items.get(itemPrice.tarkovId);
                if (!item) {
                    // we don't have this item
                    continue;
                }
                const lastPrice = lastPrices[itemPrice.tarkovId];
                const options = {
                    ...scannerOptions,
                    itemId: item.id,
                    itemPrices: [],
                };
                const lastPriceTimestamp = Math.max(
                    lastPrice?.timestamp?.getTime() ?? 0,
                    item.lastScan?.getTime() ?? 0,
                );
                const lastPriceDate = new Date(lastPriceTimestamp);
                const summaryPriceDate = new Date(itemPrice.latestPriceSample.sampleTimeEpoch * 1000);
                if (lastPriceDate < summaryPriceDate) {
                    options.timestamp = summaryPriceDate;
                    // price data is new
                    if (itemPrice.latestPriceSample.minPrice) {
                        // insert new price
                        this.logger.log(`${item.name} ${item.id} New prices: ${itemPrice.latestPriceSample.minPrice}, ${itemPrice.latestPriceSample.robustAvgPrice}`);
                        newPrices++;
                        options.offerCount = itemPrice.latestPriceSample.listingCount;
                        for (const scanned of itemPrice.latestPriceSample.latestSupplyPressure) {
                            const price = scanned[0];
                            for (let i = 0; i < scanned[1].length; i++) {
                                options.itemPrices.push({
                                    seller: 'Player',
                                    price,
                                });
                            }
                        }
                        options.itemPrices = options.itemPrices.slice(0, 12);
                        scannerApi.insertPrices(options).catch(error => {
                            this.addJobSummary(`${item.name} ${item.id}: ${error.message}`, 'Price Insert Error');
                            this.logger.log(`Error inserting ${item.name} ${item.id} prices: ${error.message}`);
                        });
                    } else {
                        // set item scanned
                        //this.logger.log(`${item.name} ${item.id} scanned`);
                        newScanned++;
                        options.scanned = true;
                        scannerApi.releaseItem(options).catch(error => {
                            this.addJobSummary(`${item.name} ${item.id}: ${error.message}`, 'Set Scanned Error');
                            this.logger.log(`Error setting ${item.name} ${item.id} scanned: ${error.message}`);
                        });
                    }
                } else if (lastPriceDate.getTime() === summaryPriceDate.getTime()) {
                    current++;
                } else {
                    //this.logger.log(`${item.name} ${item.id} current price older than last price: last price: ${lastPriceDate} current price: ${summaryPriceDate}`);
                }
            }
            this.logger.log(`${gameMode}: ${current} items already current, inserted ${newPrices} new prices, set ${newScanned} additional items as scanned`);
        }
    }

    roundDateToNearestSecond(date) {
        const roundedMilliseconds = Math.round(date.getTime() / 1000) * 1000;
        return new Date(roundedMilliseconds);
    }
}

export default UpdateFleaPricesJob;
