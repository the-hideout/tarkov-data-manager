import { DateTime } from 'luxon';

import scannerApi, { scannerFlags, userFlags } from '../modules/scanner-api.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import DataJob from '../modules/data-job.mjs';
import gameModes from '../modules/game-modes.mjs';

class CheckScansJob extends DataJob {
    constructor(options) {
        super({...options, name: 'check-scanners'});
    }

    async run() {
        const [services, scanners, activeTraderScans] = await Promise.all([
            tarkovData.status().then(status => status.services).catch(error => {
                this.logger.error(`Error getting EFT services status: ${error.message}`);
                return [];
            }),
            this.query(`
                select scanner.id, name, last_scan, trader_last_scan, pve_last_scan, pve_trader_last_scan, username, scanner.flags, scanner_user.flags as user_flags, disabled 
                from scanner 
                left join scanner_user on scanner_user.id = scanner.scanner_user_id
            `),
            scannerApi.currentTraderScans(),
        ]);

        const tradingService = services.find(s => s.name === 'Trading');
        if (tradingService?.status === 1) {
            this.logger.log('Game is updating, skipping scanner check');
            return;
        }

        const scanTypes = {
            player: '',
            trader: 'trader_',
        };

        const scanCutoff = new Date() - (1000 * 60 * 15);
        const dateNow = DateTime.now();
        for (const scanner of scanners) {
            for (const gameMode of gameModes) {
                for (const scanTypeName in scanTypes) {
                    let prefix = '';
                    if (gameMode.name !== 'regular') {
                        prefix = 'pve_';
                    }
                    prefix += scanTypes[scanTypeName];
                    if (scanner[`${prefix}last_scan`]?.getTime() < scanCutoff) {
                        this.logger.log(`${scanner.name} hasn't scanned ${gameMode.name} ${scanTypeName} prices ${dateNow.toRelative({ base: DateTime.fromJSDate(scanner[`${prefix}last_scan`]) })}; releasing any batches`);
                        this.query(`
                            UPDATE
                                item_data
                            SET
                                ${prefix}checkout_scanner_id = NULL
                            WHERE
                                ${prefix}checkout_scanner_id = ?;
                        `, [scanner.id]).catch(error => {
                            this.logger.error(`Error clearing  ${gameMode.name} ${scanTypeName} batches for ${scanner.name}: ${error.message}`);
                        });
                        if (scanTypeName === 'trader') {
                            const activeTraderScan = activeTraderScans[gameMode.name];
                            if (activeTraderScan?.scanner_id === scanner.id) {
                                scannerApi.setTraderScanScanner(gameMode.name, null);
                            }
                        }
                    } else {
                        this.logger.log(`${scanner.name} last scanned ${gameMode.name} ${scanTypeName} prices ${dateNow.toRelative({ base: DateTime.fromJSDate(scanner[`${prefix}last_scan`]) })}`);
                    }
                }
            }

            const lastScanTimestamp = Math.max(
                scanner.last_scan?.getTime() ?? 0,
                scanner.trader_last_scan?.getTime() ?? 0,
                scanner.pve_last_scan?.getTime() ?? 0,
                scanner.pve_trader_last_scan?.getTime() ?? 0,
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

            this.addJobSummary(`${encodeURIComponent(scanner.name)} (${scanner.username}) - Last scanned ${DateTime.fromJSDate(lastScan).toRelative()}`, 'Missing Scans');
        }

        // Possibility to POST to a Discord webhook here with cron status details
    }
}

export default CheckScansJob;
