const got = require('got');

const scannerApi = require('../modules/scanner-api');
const DataJob = require('../modules/data-job');

class CheckScansJob extends DataJob {
    constructor() {
        super('check-scanners');
    }

    async run() {
        const [services, scanners] = await Promise.all([
            got('https://status.escapefromtarkov.com/api/services', {
                responseType: 'json',
                resolveBodyOnly: true
            }),
            this.query(`
                select scanner.id, name, last_scan, trader_last_scan, username, scanner.flags, scanner_user.flags as user_flags, disabled 
                from scanner 
                left join scanner_user on scanner_user.id = scanner.scanner_user_id
            `),
        ]);

        for (const service of services) {
            if (!service.name === 'Trading') continue;
            if (service.status === 1) {
                this.logger.log('Game is updating, skipping scanner check')
                return;
            }
        }

        const userFlags = scannerApi.getUserFlags();
        const scannerFlags = scannerApi.getScannerFlags();
        const utcOffset = new Date().getTimezoneOffset() * 60000;
        const now = new Date();
        const scanCutoff = (now.getTime() / 1000) - 21600 - (utcOffset / 1000);
        for (const scanner of scanners) {
            if (scanner.last_scan?.getTime() / 1000 < scanCutoff) {
                this.logger.log(`${scanner.name} hasn't worked since ${scanner.last_scan}; releasing any player batches`);
                this.query(`
                    UPDATE
                        item_data
                    SET
                        checkout_scanner_id = NULL
                    WHERE
                        checkout_scanner_id = ?;
                `, [scanner.id]).catch(error => {
                    this.logger.error(`Error clearing player batches for ${scanner.name}: ${error.message}`);
                });
            }
            if (scanner.trader_last_scan?.getTime() / 1000 < scanCutoff) {
                this.logger.log(`${scanner.name} hasn't worked since ${scanner.trader_last_scan}; releasing any trader batches`);
                this.query(`
                    UPDATE
                        item_data
                    SET
                        trader_checkout_scanner_id = NULL
                    WHERE
                        trader_checkout_scanner_id = ?;
                `, [scanner.id]).catch(error => {
                    this.logger.error(`Error clearing trader batches for ${scanner.name}: ${error.message}`);
                });
            }

            if ((!scanner.last_scan && !scanner.trader_last_scan) || scanner.disabled || userFlags.skipPriceInsert & scanner.user_flags) {
                // ignore scanners that have never inserted a price
                continue;
            }
            if (scannerFlags.ignoreMissingScans & scanner.flags) {
                this.logger.log(`Ignoring scanner ${scanner.name} for missing scans`);
                continue;
            }
            if (!(userFlags.insertPlayerPrices & scanner.user_flags) && !(userFlags.insertTraderPrices & scanner.user_flags)) {
                this.logger.log(`Skipping scanner without insert flags: ${scanner.name}`);
                continue;
            }

            // sync timezone offsets
            let lastScan = new Date(scanner.last_scan?.setTime(scanner.last_scan.getTime() - utcOffset));
            const traderLastScan = new Date(scanner.trader_last_scan?.setTime(scanner.trader_last_scan.getTime() - utcOffset));
            if (traderLastScan > lastScan) {
                lastScan = traderLastScan;
            }

            const lastScanAge = Math.floor((new Date().getTime() - lastScan.getTime()) / 1000);
            this.logger.log(`${scanner.name}: ${lastScanAge}s`);

            if (lastScanAge < 1800) {
                continue;
            }           

            const messageData = {
                title: `Missing scans from ${encodeURIComponent(scanner.name)} (${scanner.username})`,
                message: `The last scanned price was ${lastScanAge} seconds ago`
            };

            this.logger.log('Sending alert');
            this.discordAlert(messageData);
        }

        // Possibility to POST to a Discord webhook here with cron status details
        //await scannerApi.waitForActions();
    }
}

module.exports = CheckScansJob;
