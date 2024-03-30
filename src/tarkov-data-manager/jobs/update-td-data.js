const tarkovDevData = require('../modules/tarkov-dev-data');
const DataJob = require('../modules/data-job');

class UpdateTdDataJob extends DataJob {
    constructor() {
        super('update-tc-data');
    }

    async run() {
        this.logger.log('Downloading data from...');
        this.logger.time('td-download');
        const results = await tarkovDevData.downloadAll();
        if (Object.keys(results) > 1) {
            this.logger.log(`Downloaded ${Object.keys(results).filter(key => key !== 'errors').join(', ')} files`);
        }
        if (Object.keys(results.errors).length === 0) {
            this.logger.success('Successfully downloaded data');
        }
        if (Object.keys(results.errors).length > 0) {
            const errors = [];
            for (const jsonName in results.errors) {
                this.logger.warn(`Error downloading ${jsonName}: ${results.errors[jsonName]}`);
                errors.push(`${jsonName}: ${results.errors[jsonName]}`);
            }
            this.discordAlert({
                title: 'Error(s) updating TD data',
                message: results.errors.join(', '),
            });
        }
        this.logger.timeEnd('td-download');
        return results;
    }
}

module.exports = UpdateTdDataJob;