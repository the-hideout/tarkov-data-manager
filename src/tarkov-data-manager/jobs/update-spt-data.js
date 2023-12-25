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

        this.logger.log('Downloading loot data...');
        this.logger.time('loot-download');
        const loot = await spt.mapLoot(true);
        this.logger.log(`Downloaded loot: ${Object.keys(loot).join(', ')}`);
        this.logger.timeEnd('loot-download');

        this.logger.log('Downloading quest config data...');
        this.logger.time(('quest-config'));
        await spt.questConfig(true);
        this.logger.log('Downloaded quest config');
        this.logger.timeEnd('quest-config');

        this.logger.success('Successfully downloaded data');
    }
}

module.exports = UpdateLangJob;
