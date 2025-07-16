import DataJob from '../modules/data-job.mjs';
import tarkovDevData from '../modules/tarkov-dev-data.mjs';
import webSocketServer from '../modules/websocket-server.mjs';
import gameModes from '../modules/game-modes.mjs';

class UpdateTdDataJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-td-data'});
    }

    async run() {
        const services = await tarkovDevData.status().then(status => status.services).catch(error => {
            this.logger.error(`Error getting EFT services status: ${error.message}`);
            return [];
        });

        const tradingService = services.find(s => s.name === 'Trading');
        if (tradingService?.status === 1 && webSocketServer.launchedScanners().length === 0) {
            this.logger.log('Game is updating, skipping data update');
            return;
        }

        const returnValue = {};
        this.logger.time('td-download');
        for (const gameMode of gameModes) {
            this.logger.log(`Downloading ${gameMode.name} data...`);
            
            returnValue[gameMode.name] = await tarkovDevData.downloadAll({returnErrors: true, gameMode: gameMode.name}).then(results => {
                const errors = results.errors;
                results.errors = undefined;
                if (Object.keys(results).length > 0) {
                    this.logger.success(`Downloaded: ${Object.keys(results).filter(key => key !== 'errors').join(', ')}`);
                }
                if (errors) {
                    this.logger.warn(`Error downloading ${gameMode.name} data: ${Object.keys(errors).map(file => `${file}: ${errors[file].message}`).join(', ')}`);
                    Object.keys(errors).forEach(file => this.addJobSummary(`${file}: ${errors[file].message}`, `Error(s) updating TD ${gameMode.name} data`));
                }
                return results;
            });
        }
        this.logger.timeEnd('td-download');
        return returnValue;
    }
}

export default UpdateTdDataJob;
