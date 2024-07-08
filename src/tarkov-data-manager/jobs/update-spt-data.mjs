import DataJob from '../modules/data-job.mjs';
import spt from '../modules/tarkov-spt.mjs';

class UpdateLangJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-spt-data'});
    }

    run = async () => {
        this.logger.log('Downloading language data...');
        this.logger.time('lang-download');
        this.logger.log(`Downloaded locales: ${Object.keys(await spt.locales(true)).join(', ')}`);
        this.logger.timeEnd('lang-download');

        this.logger.log('Downloading bot data...');
        this.logger.time('bot-download');
        this.logger.log(`Downloaded bots: ${Object.keys(await spt.botsInfo(true)).join(', ')}`);
        this.logger.timeEnd('bot-download');

        this.logger.log('Downloading loot data...');
        this.logger.time('loot-download');
        this.logger.log(`Downloaded loot: ${Object.keys(await spt.mapLoot(true)).join(', ')}`);
        this.logger.timeEnd('loot-download');

        this.logger.log('Downloading quest config data...');
        this.logger.time(('quest-config'));
        await spt.questConfig(true);
        this.logger.log('Downloaded quest config');
        this.logger.timeEnd('quest-config');

        this.logger.success('Successfully downloaded data');
    }
}

export default UpdateLangJob;
