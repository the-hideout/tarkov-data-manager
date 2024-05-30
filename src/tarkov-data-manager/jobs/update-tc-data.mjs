import DataJob from '../modules/data-job.mjs';
import tarkovChanges from '../modules/tarkov-changes.mjs';

class UpdateTcDataJob extends DataJob {
    constructor() {
        super('update-tc-data');
    }

    async run() {
        this.logger.log('Downloading data from Tarkov-Changes...');
        this.logger.time('tc-download');
        return tarkovChanges.downloadAll(true).then(results => {
            if (Object.keys(results) > 1) {
                this.logger.log(`Downloaded ${Object.keys(results).filter(key => key !== 'errors').join(', ')}`);
            }
            if (results.errors.length === 0) {
                this.logger.success('Successfully downloaded data from Tarkov Changes');
            }
            if (results.errors.length > 0) {
                this.logger.warn(`Error downloading some data from Tarkov Changes: ${results.errors.join(', ')}`);
            }
            if (Object.keys(results) === 1) {
                this.logger.error(`Error downloading data from Tarkov Changes: ${results.errors.join(', ')}`);
                this.discordAlert({
                    title: 'Error(s) updating TC data',
                    message: results.errors.join(', '),
                })
            }
            this.logger.timeEnd('tc-download');
            return results;
        });
    }
}

export default UpdateTcDataJob;