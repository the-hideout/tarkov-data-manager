import scannerApi from '../modules/scanner-api.mjs';
import webSocketServer from '../modules/websocket-server.mjs';
import DataJob from '../modules/data-job.mjs';

class StartTraderScanJob extends DataJob {
    constructor() {
        super('start-trader-scan');
    }

    async run() {
        this.logger.log('Starting trader scan...');
        if (await scannerApi.currentTraderScan()) {
            this.logger.log('Trader scan already in progress');
        } else {
            await scannerApi.startTraderScan({scanner: {id: 0}});
        }

        //let scanners = webSocketServer.launchedScanners().filter(c => c.settings.scanStatus === 'idle' && c.settings.scanMode === 'auto');
        for (const scanner of webSocketServer.launchedScanners()) {
            this.logger.log(`${scanner.name} ${scanner.settings.scanStatus} ${scanner.settings.scanMode}`);
            if (scanner.settings.scanStatus !== 'idle' || scanner.settings.scanMode !== 'auto') {
                continue;
            }
            this.logger.log(`Starting ${scanner.name}`);
            //await webSocketServer.sendCommand(scanner.name, 'changeSetting', {name: 'offersFrom', value: 1});
            await webSocketServer.sendCommand(scanner.name, 'resume');
        }
    }
}

export default StartTraderScanJob;
