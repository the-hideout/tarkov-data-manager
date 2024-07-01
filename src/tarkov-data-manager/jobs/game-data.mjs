import { connection } from '../modules/db-connection.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import DataJob from '../modules/data-job.mjs';

class GameDataJob extends DataJob {
    constructor(options) {
        super({...options, name: 'game-data'});
    }

    async run() {
        const keepAlive = connection.keepAlive;
        connection.keepAlive = true;
        
        await this.jobManager.runJob('update-tc-data', {parent: this});

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

        connection.keepAlive = keepAlive;
    }
}

export default GameDataJob;
