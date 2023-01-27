const tarkovChanges = require('../modules/tarkov-changes');
const DataJob = require('../modules/data-job');

class UpdateTcDataJob extends DataJob {
    constructor(jobManager) {
        super({name: 'update-tc-data', jobManager});
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