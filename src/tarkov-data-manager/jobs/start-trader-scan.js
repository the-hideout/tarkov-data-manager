const scannerApi = require('../modules/scanner-api');
const webSocketServer = require('../modules/websocket-server');
const DataJob = require('../modules/data-job');

class StartTraderScanJob extends DataJob {
    constructor() {
        super('start-trader-scan');
    }

    async run() {
        this.logger.log('Starting trader scan...');
        if (await scannerApi.traderScanInProgress()) {
            this.logger.log('Trader scan already in progress');
        } else {
            await scannerApi.startTraderScan({scanner: {id: 0}});
        }

        let scanners = webSocketServer.launchedScanners().filter(c => c.status === 'idle' && c.settings.scanMode === 'auto');
        for (const scanner of scanners) {
            this.logger.log(`Starting ${scanner.name}`);
            await webSocketServer.sendCommand(scanner.name, 'changeSetting', {name: 'offersFrom', value: 1});
            await webSocketServer.sendCommand(scanner.name, 'resume');
        }
    }
}

module.exports = StartTraderScanJob;