import DataJob from '../modules/data-job.mjs';
import tarkovChanges from '../modules/tarkov-changes.mjs';
import gameModes from '../modules/game-modes.mjs';

class UpdateTcDataJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-tc-data'});
    }

    async run() {
        this.logger.log('Downloading data from Tarkov-Changes...');
        this.logger.time('tc-download');
        const returnValue = {};
        for (const gameMode of gameModes) {
            this.logger.log(`Downloading ${gameMode.name} data...`);
            returnValue[gameMode.name] = await tarkovChanges.downloadAll({returnPartial: true, gameMode: gameMode.name}).then(results => {
                if (Object.keys(results).length > 1) {
                    this.logger.success(`Downloaded: ${Object.keys(results).filter(key => key !== 'errors').join(', ')}`);
                }
                if (results.errors.length > 0) {
                    this.logger.warn(`Error downloading some ${gameMode.name} data: ${results.errors.join(', ')}`);
                }
                if (Object.keys(results) === 1) {
                    this.logger.error(`Error(s) downloading ${gameMode.name} data: ${results.errors.join(', ')}`);
                    results.errors.forEach(errMessage => this.addJobSummary(errMessage, `Error(s) updating TC ${gameMode.name} data`));
                }
                return results;
            });
        }
        this.logger.timeEnd('tc-download');
        return returnValue;
    }
}

export default UpdateTcDataJob;