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
            
            returnValue[gameMode.name] = await tarkovDevData.downloadAll({returnPartial: true, gameMode: gameMode.name}).then(results => {
                if (Object.keys(results).length > 1) {
                    this.logger.success(`Downloaded: ${Object.keys(results).filter(key => key !== 'errors').join(', ')}`);
                }
                if (results.errors.length > 0) {
                    this.logger.warn(`Error downloading some ${gameMode.name} data: ${results.errors.join(', ')}`);
                }
                if (Object.keys(results) === 1) {
                    this.logger.error(`Error(s) downloading ${gameMode.name} data: ${results.errors.join(', ')}`);
                    results.errors.forEach(errMessage => this.addJobSummary(errMessage, `Error(s) updating TD ${gameMode.name} data`));
                }
                return results;
            });
        }
        this.logger.timeEnd('td-download');
        return returnValue;
    }
}

export default UpdateTdDataJob;
