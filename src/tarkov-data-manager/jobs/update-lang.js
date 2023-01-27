//const tarkovBot = require('../modules/tarkov-bot');
const spt = require('../modules/tarkov-spt');
const DataJob = require('../modules/data-job');

class UpdateLangJob extends DataJob {
    constructor(jobManager) {
        super({name: 'update-lang', jobManager});
    }

    run = async () => {
        this.logger.log('Downloading language data from Tarkov-Bot and SPT...');
        this.logger.time('lang-download');
        await Promise.all([
            //tarkovBot.locale('ru', true, logger),
            spt.locales(true),
        ]);
        this.logger.timeEnd('lang-download');
        this.logger.success('Successfully downloaded data from Tarkov-Bot and SPT');
    }
}

module.exports = UpdateLangJob;
