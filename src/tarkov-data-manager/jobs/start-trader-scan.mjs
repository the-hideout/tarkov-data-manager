import scannerApi from '../modules/scanner-api.mjs';
import tarkovDevData from '../modules/tarkov-data-tarkov-dev.mjs';
import DataJob from '../modules/data-job.mjs';

class StartTraderScanJob extends DataJob {
    constructor(options) {
        super({...options, name: 'start-trader-scan'});
    }

    async run() {
        const traderScanGameModes = ['regular', 'pve'];
        const scannersStatus = await tarkovDevData.scannersStatus();
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
                for (const scannerDomain in scannersStatus) {
                    const scanner = scannersStatus[scannerDomain];
                    if (scanner.status !== 'idle' || scanner.scanMode !== 'auto') {
                        continue;
                    }
                    if (scanner.gameMode !== gameMode.name) {
                        return;
                    }
                    this.logger.log(`Starting ${scanner.name}`);
                    await scannerApi.setTraderScanScanner(gameMode.name, scanner.name);
                    await tarkovDevData.scannerStart(scannerDomain);
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
