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
            returnValue[gameMode.name] = await tarkovChanges.downloadAll({returnErrors: true, gameMode: gameMode.name, signal: this.abortController.signal}).then(results => {
                const errors = results.errors;
                results.errors = undefined;
                if (Object.keys(results).length > 0) {
                    this.logger.success(`Downloaded: ${Object.keys(results).filter(key => key !== 'errors').join(', ')}`);
                }
                if (errors) {
                    this.logger.warn(`Error downloading ${gameMode.name} data: ${Object.keys(errors).map(file => `${file}: ${errors[file].message}`).join(', ')}`);
                    Object.keys(errors).forEach(file => this.addJobSummary(`${file}: ${errors[file].message}`, `Error(s) updating TC ${gameMode.name} data`));
                }
                return results;
            });
        }
        this.logger.timeEnd('tc-download');
        return returnValue;
    }
}

export default UpdateTcDataJob;