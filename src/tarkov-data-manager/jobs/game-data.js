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

        await this.jobManager.runJob('update-new-items', {parent: this});

        await this.jobManager.runJob('update-item-names', {parent: this});

        await this.jobManager.runJob('update-types', {parent: this});

        await this.jobManager.runJob('update-presets', {parent: this});

        this.logger.log('Updating handbook...');
        await tarkovData.handbook(true).catch(error => {
            this.logger.error(error);
            return tarkovData.handbook(false);
        });
        this.logger.log('Completed updating handbook');

        connection.keepAlive = keepAlive;
    }
}

module.exports = GameDataJob;
