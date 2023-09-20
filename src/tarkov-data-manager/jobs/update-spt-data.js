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
        const locales = await spt.locales(true);
        this.logger.log(`Downloaded locales: ${Object.keys(locales).join(', ')}`);
        this.logger.timeEnd('lang-download');
        this.logger.log('Downloading bot data...');
        this.logger.time('bot-download');
        const bots = await spt.botsInfo(true);
        this.logger.log(`Downloaded bots: ${Object.keys(bots).join(', ')}`);
        this.logger.timeEnd('bot-download');
        this.logger.success('Successfully downloaded data');
    }
}

module.exports = UpdateLangJob;
