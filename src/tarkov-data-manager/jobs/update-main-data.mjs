import DataJob from '../modules/data-job.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import webSocketServer from '../modules/websocket-server.mjs';
import gameModes from '../modules/game-modes.mjs';

class UpdateMainDataJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-main-data'});
    }

    async run() {
        const services = await tarkovData.status().then(status => status.services).catch(error => {
            this.logger.error(`Error getting EFT services status: ${error.message}`);
            return [];
        });

        const tradingService = services.find(s => s.name === 'Trading');
        if (tradingService?.status === 1 && webSocketServer.launchedScanners().length === 0) {
            this.logger.log('Game is updating, skipping data update');
            return;
        }

        const returnValue = {};
        this.logger.time('data-download');
        const reqs = [];
        for (const gameMode of gameModes) {
            this.logger.log(`Downloading ${gameMode.name} data...`);
            
            reqs.push(tarkovData.downloadAll({returnErrors: true, gameMode: gameMode.name}).then(results => {
                const errors = results.errors;
                results.errors = undefined;
                if (Object.keys(results).length > 0) {
                    this.logger.success(`Downloaded ${gameMode.name}: ${Object.keys(results).filter(key => key !== 'errors').join(', ')}`);
                }
                if (errors) {
                    this.logger.warn(`Error downloading ${gameMode.name} data: ${Object.keys(errors).map(file => `${file}: ${errors[file].message}`).join(', ')}`);
                    Object.keys(errors).forEach(file => this.addJobSummary(`${file}: ${errors[file].message}`, `Error(s) updating ${gameMode.name} data`));
                }
                returnValue[gameMode.name] = results;
                return results;
            }));
        }
        await Promise.all(reqs);
        this.logger.timeEnd('data-download');
        return returnValue;
    }
}

export default UpdateMainDataJob;
