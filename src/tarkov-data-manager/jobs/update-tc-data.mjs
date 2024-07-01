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
            returnValue[gameMode.name] = await tarkovChanges.downloadAll({returnPartial: true, gameMode: gameMode.name}).then(results => {
                if (Object.keys(results) > 1) {
                    this.logger.log(`Downloaded ${Object.keys(results).filter(key => key !== 'errors').join(', ')} ${gameMode.name} files`);
                }
                if (results.errors.length === 0) {
                    this.logger.success(`Successfully downloaded ${gameMode.name} data from Tarkov Changes`);
                }
                if (results.errors.length > 0) {
                    this.logger.warn(`Error downloading some${gameMode.name} data from Tarkov Changes: ${results.errors.join(', ')}`);
                }
                if (Object.keys(results) === 1) {
                    this.logger.error(`Error downloading ${gameMode.name} data from Tarkov Changes: ${results.errors.join(', ')}`);
                    this.discordAlert({
                        title: `Error(s) updating TC ${gameMode.name} data`,
                        message: results.errors.join(', '),
                    })
                }
            });
        }
        this.logger.timeEnd('tc-download');
        return returnValue;
    }
}

export default UpdateTcDataJob;