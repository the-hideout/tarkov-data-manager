const got = require('got');

const { query } = require('../modules/db-connection');
const webhook = require('../modules/webhook');
const scannerApi = require('../modules/scanner-api');
const DataJob = require('../modules/data-job');

class CheckScansJob extends DataJob {
    constructor() {
        super('check-scans');
    }

    async run() {
        const services = await got('https://status.escapefromtarkov.com/api/services', {
            responseType: 'json',
            resolveBodyOnly: true
        });

        for (const service of services) {
            if (!service.name === 'Trading') continue;
            if (service.status === 1) {
                this.logger.log('Game is updating, skipping scan check')
                return;
            }
        }

        const scanners = await query(`
            select scanner.id, name, last_scan, username, scanner.flags, scanner_user.flags as user_flags, disabled 
            from scanner 
            left join scanner_user on scanner_user.id = scanner.scanner_user_id
        `);
        const userFlags = scannerApi.getUserFlags();
        const scannerFlags = scannerApi.getScannerFlags();
        for (const scanner of scanners) {
            if (!scanner.last_scan || scanner.disabled || userFlags.skipPriceInsert & scanner.user_flags) {
                // ignore scanners that have never inserted a price
                continue;
            }
            if (scannerFlags.ignoreMissingScans & scanner.flags) {
                this.logger.log(`Ignoring source: ${scanner.name}`);
                continue;
            }
            if (!(userFlags.insertPlayerPrices & scanner.user_flags) && !(userFlags.insertTraderPrices & scanner.user_flags)) {
                this.logger.log(`Skipping scanner without insert flags: ${scanner.name}`);
                continue;
            }

            //logger.log(JSON.stringify(scanner));
            // Db timestamps are off so we add an hour
            const lastScan = new Date(scanner.last_scan.setTime(scanner.last_scan.getTime() + 3600000));

            // console.log(lastScan);
            // console.log(new Date());

            // console.log(lastScan.getTimezoneOffset());
            // console.log(new Date().getTimezoneOffset());

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
            webhook.alert(messageData);
        }

        // Possibility to POST to a Discord webhook here with cron status details
        //await scannerApi.waitForActions();
    }
}

module.exports = CheckScansJob;
