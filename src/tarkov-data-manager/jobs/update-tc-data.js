const tarkovChanges = require('../modules/tarkov-changes');
const DataJob = require('../modules/data-job');

class UpdateTcDataJob extends DataJob {
    constructor() {
        super('update-tc-data');
    }

    async run() {
        this.logger.log('Downloading data from Tarkov-Changes...');
        this.logger.time('tc-download');
        await tarkovChanges.downloadAll();
        this.logger.timeEnd('tc-download');
        this.logger.success('Successfully downloaded data from Tarkov-Changes');
    }
}

module.exports = UpdateTcDataJob;