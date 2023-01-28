const { query } = require('../modules/db-connection');
const DataJob = require('../modules/data-job');

class ClearCheckoutsJob extends DataJob {
    constructor() {
        super('clear-checkouts');
    }

    async run() {
        const scanners = await query('SELECT * FROM scanner').then(results => {
            const scannerMap = {};
            for (const scanner of results) {
                scannerMap[scanner.id] = scanner;
            }
            return scannerMap;
        });
        const now = new Date();
        const scanCutoff = (now.getTime() / 1000) - 21600 - (now.getTimezoneOffset() * 60);
        const playerPrices = query(`
            SELECT
                MAX(timestamp) AS last_scan,
                scanner_id
            FROM
                price_data
            GROUP BY
            scanner_id;
        `).then(async results => {
            for(const scannerResult of results){
                if((scannerResult.last_scan.getTime() / 1000) > scanCutoff){
                    continue;
                }
                this.logger.log(`${scanners[scannerResult.scanner_id].name} hasn't worked since ${scannerResult.last_scan}; releasing any batches`);
                await query(`
                    UPDATE
                        item_data
                    SET
                        checkout_scanner_id = NULL
                    WHERE
                        checkout_scanner_id = ?;
                `, [scannerResult.scanner_id]);
            }
        });
        const traderPrices = query(`
            SELECT
                MAX(timestamp) AS last_scan,
                scanner_id
            FROM
                trader_price_data
            GROUP BY
            scanner_id;
        `).then(async results => {
            for(const scannerResult of results){
                if((scannerResult.last_scan.getTime() / 1000) > scanCutoff){
                    continue;
                }
                this.logger.log(`${scanners[scannerResult.scanner_id].name} hasn't worked since ${scannerResult.last_scan}; releasing any trader batches`);
                return query(`
                    UPDATE
                        item_data
                    SET
                        trader_checkout_scanner_id = NULL
                    WHERE
                    trader_checkout_scanner_id = ?;
                `, [scannerResult.scanner_id]);
            }
        });
        await Promise.all([playerPrices, traderPrices]);
    }
}

module.exports = ClearCheckoutsJob;
