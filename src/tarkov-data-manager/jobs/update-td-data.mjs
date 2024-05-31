import DataJob from '../modules/data-job.mjs';
import tarkovDevData from '../modules/tarkov-dev-data.mjs';

class UpdateTdDataJob extends DataJob {
    constructor() {
        super('update-td-data');
    }

    async run() {
        this.logger.log('Downloading data from...');
        this.logger.time('td-download');
        const results = await tarkovDevData.downloadAll('regular');
        if (Object.keys(results).length > 1) {
            this.logger.log(`Downloaded ${Object.keys(results).filter(key => key !== 'errors').join(', ')}`);
        }
        if (Object.keys(results.errors).length === 0) {
            this.logger.success('Successfully downloaded data');
        } else {
            const errors = [];
            for (const jsonName in results.errors) {
                this.logger.warn(`Error downloading ${jsonName}: ${results.errors[jsonName]}`);
                errors.push(`${jsonName} - ${results.errors[jsonName]}`);
            }
            this.discordAlert({
                title: 'Error(s) updating TD data',
                message: errors.join('\n'),
            });
        }
        this.logger.timeEnd('td-download');
        return results;
    }
}

export default UpdateTdDataJob;
