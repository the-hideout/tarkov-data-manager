const got = require('got');
const { DateTime } = require('luxon');

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
            }).catch(error => {
                this.logger.error(`Error getting EFT services status: ${error.message}`);
                return [];
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
        const utcNow = new Date(Date.now() + utcOffset);
        const scanCutoff = utcNow.getTime() - (1000 * 60 * 15);
        const dateUtc = DateTime.fromJSDate(utcNow);
        for (const scanner of scanners) {
            if (scanner.last_scan?.getTime() < scanCutoff) {
                this.logger.log(`${scanner.name} hasn't scanned player prices ${dateUtc.toRelative({ base: DateTime.fromJSDate(scanner.last_scan) })}; releasing any batches`);
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
            if (scanner.trader_last_scan?.getTime() < scanCutoff) {
                this.logger.log(`${scanner.name} hasn't scanned trader prices ${dateUtc.toRelative({ base: DateTime.fromJSDate(scanner.trader_last_scan) })}; releasing any batches`);
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
            this.logger.log(`${scanner.name}: Last scanned ${DateTime.fromJSDate(lastScan).toRelative()}`);

            if (lastScanAge < 1800) {
                continue;
            }           

            const messageData = {
                title: `Missing scans from ${encodeURIComponent(scanner.name)} (${scanner.username})`,
                message: `The last scanned ${DateTime.fromJSDate(lastScan).toRelative()}`
            };

            this.logger.log('Sending alert');
            this.discordAlert(messageData);
        }

        // Possibility to POST to a Discord webhook here with cron status details
        //await scannerApi.waitForActions();
    }
}

module.exports = CheckScansJob;
