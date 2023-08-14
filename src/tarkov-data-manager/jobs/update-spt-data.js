//const tarkovBot = require('../modules/tarkov-bot');
const spt = require('../modules/tarkov-spt');
const DataJob = require('../modules/data-job');

class UpdateLangJob extends DataJob {
    constructor() {
        super('update-spt-data');
    }

    run = async () => {
        this.logger.log('Downloading language data...');
        this.logger.time('lang-download');
        await spt.locales(true);
        this.logger.timeEnd('lang-download');
        this.logger.log('Downloading bot data...');
        this.logger.time('bot-download');
        await spt.botsInfo(true);
        this.logger.timeEnd('bot-download');
        this.logger.success('Successfully downloaded data');
    }
}

module.exports = UpdateLangJob;
