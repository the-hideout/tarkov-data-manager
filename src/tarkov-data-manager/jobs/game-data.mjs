import tarkovData from '../modules/tarkov-data.mjs';
import DataJob from '../modules/data-job.mjs';

class GameDataJob extends DataJob {
    constructor(options) {
        super({...options, name: 'game-data'});
    }

    async run() {
        
        await this.jobManager.runJob('update-main-data', {parent: this});

        this.logger.log('Updating handbook...');
        await tarkovData.handbook({download: true}).catch(error => {
            this.logger.error(error);
            return tarkovData.handbook({download: true});
        });

        const subJobs = [
            'update-new-items',
            'update-item-names',
            'update-types',
            'update-presets',
            'update-traders',
            'update-hideout',
            'update-crafts',
        ];

        for (const jobName of subJobs) {
            await this.jobManager.runJob(jobName, {parent: this}).catch(error => {
                this.logger.error(`Error running ${jobName}: ${error.message}`);
            });
        }
    }
}

export default GameDataJob;
