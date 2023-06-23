const { connection } = require('../modules/db-connection');
const tarkovData = require('../modules/tarkov-data');
const DataJob = require('../modules/data-job');

class GameDataJob extends DataJob {
    constructor() {
        super('game-data');
    }

    async run() {
        const keepAlive = connection.keepAlive;
        connection.keepAlive = true;
        
        await this.jobManager.runJob('update-tc-data', {parent: this});

        this.logger.log('Updating handbook...');
        await tarkovData.handbook(true).catch(error => {
            this.logger.error(error);
            return tarkovData.handbook(false);
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

module.exports = GameDataJob;
