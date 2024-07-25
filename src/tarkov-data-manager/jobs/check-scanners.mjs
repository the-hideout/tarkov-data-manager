import { DateTime } from 'luxon';

import scannerApi, { scannerFlags, userFlags } from '../modules/scanner-api.mjs';
import tarkovDevData from '../modules/tarkov-dev-data.mjs';
import DataJob from '../modules/data-job.mjs';
import gameModes from '../modules/game-modes.mjs';

class CheckScansJob extends DataJob {
    constructor(options) {
        super({...options, name: 'check-scanners'});
    }

    async run() {
        const [services, scanners, activeTraderScan] = await Promise.all([
            tarkovDevData.status().then(status => status.services).catch(error => {
                this.logger.error(`Error getting EFT services status: ${error.message}`);
                return [];
            }),
            this.query(`
                select scanner.id, name, last_scan, trader_last_scan, pve_last_scan, username, scanner.flags, scanner_user.flags as user_flags, disabled 
                from scanner 
                left join scanner_user on scanner_user.id = scanner.scanner_user_id
            `),
            scannerApi.currentTraderScan(),
        ]);

        const tradingService = services.find(s => s.name === 'Trading');
        if (tradingService?.status === 1) {
            this.logger.log('Game is updating, skipping scanner check');
            return;
        }

        const scanCutoff = new Date() - (1000 * 60 * 15);
        const dateNow = DateTime.now();
        for (const scanner of scanners) {
            for (const gameMode of gameModes) {
                let prefix = '';
                if (gameMode.name !== 'regular') {
                    prefix = 'pve_';
                }
                if (scanner[`${prefix}last_scan`]?.getTime() ?? 0 < scanCutoff) {
                    this.logger.log(`${scanner.name} hasn't scanned ${gameMode.name} player prices ${dateNow.toRelative({ base: DateTime.fromJSDate(scanner.last_scan) })}; releasing any batches`);
                    this.query(`
                        UPDATE
                            item_data
                        SET
                            ${prefix}checkout_scanner_id = NULL
                        WHERE
                            ${prefix}checkout_scanner_id = ?;
                    `, [scanner.id]).catch(error => {
                        this.logger.error(`Error clearing player batches for ${scanner.name}: ${error.message}`);
                    });
                }
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
                if (activeTraderScan?.scanner_id === scanner.id) {
                    scannerApi.setTraderScanScanner(null);
                }
            }

            const lastScanTimestamp = Math.max(
                scanner.last_scan?.getTime() ?? 0,
                scanner.trader_last_scan?.getTime() ?? 0,
                scanner.pve_last_scan?.getTime() ?? 0,
            );
            if ((!lastScanTimestamp) || scanner.disabled || userFlags.skipPriceInsert & scanner.user_flags) {
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

            const lastScan = new Date(lastScanTimestamp);

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
