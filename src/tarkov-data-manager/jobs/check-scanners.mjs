import { DateTime } from 'luxon';

import { scannerFlags, userFlags } from '../modules/scanner-api.mjs';
import tarkovDevData from '../modules/tarkov-dev-data.mjs';
import DataJob from '../modules/data-job.mjs';

class CheckScansJob extends DataJob {
    constructor(options) {
        super({...options, name: 'check-scanners'});
    }

    async run() {
        const [services, scanners] = await Promise.all([
            tarkovDevData.status().then(status => status.services).catch(error => {
                this.logger.error(`Error getting EFT services status: ${error.message}`);
                return [];
            }),
            this.query(`
                select scanner.id, name, last_scan, trader_last_scan, username, scanner.flags, scanner_user.flags as user_flags, disabled 
                from scanner 
                left join scanner_user on scanner_user.id = scanner.scanner_user_id
            `),
        ]);

        const tradingService = services.find(s => s.name === 'Trading');
        if (tradingService?.status === 1) {
            this.logger.log('Game is updating, skipping scanner check');
            return;
        }

        const scanCutoff = new Date() - (1000 * 60 * 15);
        const dateNow = DateTime.now();
        for (const scanner of scanners) {
            if (scanner.last_scan?.getTime() < scanCutoff) {
                this.logger.log(`${scanner.name} hasn't scanned player prices ${dateNow.toRelative({ base: DateTime.fromJSDate(scanner.last_scan) })}; releasing any batches`);
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
                this.logger.log(`${scanner.name} hasn't scanned trader prices ${dateNow.toRelative({ base: DateTime.fromJSDate(scanner.trader_last_scan) })}; releasing any batches`);
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
                this.logger.log(`Skipping missing scans alert for scanner ${scanner.name} due to ignore flag`);
                continue;
            }
            if (!(userFlags.insertPlayerPrices & scanner.user_flags) && !(userFlags.insertTraderPrices & scanner.user_flags)) {
                this.logger.log(`Skipping scanner without insert flags: ${scanner.name}`);
                continue;
            }

            let lastScan = scanner.last_scan;
            if (scanner.trader_last_scan > lastScan) {
                lastScan = scanner.trader_last_scan;
            }

            const lastScanAge = Math.floor((new Date().getTime() - lastScan.getTime()) / 1000);
            this.logger.log(`${scanner.name}: Last scanned ${DateTime.fromJSDate(lastScan).toRelative()}`);

            if (lastScanAge < 1800) {
                continue;
            }           

            const messageData = {
                title: `Missing scans from ${encodeURIComponent(scanner.name)} (${scanner.username})`,
                message: `Last scanned ${DateTime.fromJSDate(lastScan).toRelative()}`
            };

            this.logger.log('Sending alert');
            this.discordAlert(messageData);
        }

        // Possibility to POST to a Discord webhook here with cron status details
    }
}

export default CheckScansJob;
