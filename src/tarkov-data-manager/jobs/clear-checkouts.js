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
        for (const scanner of scanners) {
            if (scanner.last_scan.getTime() / 1000 < scanCutoff) {
                this.logger.log(`${scanner.name} hasn't worked since ${scanner.last_scan}; releasing any batches`);
                await query(`
                    UPDATE
                        item_data
                    SET
                        checkout_scanner_id = NULL
                    WHERE
                        checkout_scanner_id = ?;
                `, [scanner.id]);
            }
            if ((scanner.trader_last_scan.getTime() / 1000) < scanCutoff) {
                this.logger.log(`${scanner.name} hasn't worked since ${scanner.trader_last_scan}; releasing any trader batches`);
                return query(`
                    UPDATE
                        item_data
                    SET
                        trader_checkout_scanner_id = NULL
                    WHERE
                        trader_checkout_scanner_id = ?;
                `, [scanner.id]);
            }
        }
    }
}

module.exports = ClearCheckoutsJob;
