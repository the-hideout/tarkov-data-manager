import scannerApi from '../modules/scanner-api.mjs';
import webSocketServer from '../modules/websocket-server.mjs';
import DataJob from '../modules/data-job.mjs';

class StartTraderScanJob extends DataJob {
    constructor(options) {
        super({...options, name: 'start-trader-scan'});
    }

    async run() {
        this.logger.log('Starting trader scan...');
        if (await scannerApi.currentTraderScan()) {
            this.logger.log('Trader scan already in progress');
        } else {
            await scannerApi.startTraderScan();
        }

        const traderScan = await scannerApi.currentTraderScan();
        if (!traderScan.scanner_name) {
            for (const scanner of webSocketServer.launchedScanners()) {
                if (scanner.settings.scanStatus !== 'idle' || scanner.settings.scanMode !== 'auto') {
                    continue;
                }
                this.logger.log(`Starting ${scanner.name}`);
                await scannerApi.setTraderScanScanner(scanner.name);
                //await webSocketServer.sendCommand(scanner.name, 'changeSetting', {name: 'offersFrom', value: 1});
                await webSocketServer.sendCommand(scanner.name, 'resume');
                break;
            }
            if (!traderScan.scanner_name) {
                this.logger.log('Could not find an idle scanner to assign');
            }
        } else {
            this.logger.log(`${traderScan.scanner_name} already assigned to scan`);
        }
    }
}

export default StartTraderScanJob;
