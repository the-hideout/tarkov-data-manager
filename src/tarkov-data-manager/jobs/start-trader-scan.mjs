import scannerApi from '../modules/scanner-api.mjs';
import webSocketServer from '../modules/websocket-server.mjs';
import DataJob from '../modules/data-job.mjs';

class StartTraderScanJob extends DataJob {
    constructor(options) {
        super({...options, name: 'start-trader-scan'});
    }

    async run() {
        const traderScanGameModes = ['regular', 'pve'];
        for (const gameMode of this.gameModes) {
            if (!traderScanGameModes.includes(gameMode.name)) {
                continue;
            }
            this.logger.log(`Starting ${gameMode.name} trader scan...`);
    
            if (await scannerApi.currentTraderScan(gameMode.name)) {
                this.logger.log(`${gameMode.name} trader scan already in progress`);
            } else {
                await scannerApi.startTraderScan(gameMode.name);
            }
    
            const traderScan = await scannerApi.currentTraderScan(gameMode.name);
            if (!traderScan.scanner_name) {
                for (const scanner of webSocketServer.launchedScanners()) {
                    if (scanner.settings.scanStatus !== 'idle' || scanner.settings.scanMode !== 'auto') {
                        continue;
                    }
                    if (scanner.settings.sessionMode !== gameMode.name) {
                        return;
                    }
                    this.logger.log(`Starting ${scanner.name}`);
                    await scannerApi.setTraderScanScanner(gameMode.name, scanner.name);
                    //await webSocketServer.sendCommand(scanner.name, 'changeSetting', {name: 'offersFrom', value: 1});
                    await webSocketServer.sendCommand(scanner.name, 'resume');
                    break;
                }
                if (!traderScan.scanner_name) {
                    this.logger.log(`Could not find an idle ${gameMode.name} scanner to assign`);
                }
            } else {
                this.logger.log(`${traderScan.scanner_name} already assigned to ${gameMode.name} scan`);
            }
        }
    }
}

export default StartTraderScanJob;
