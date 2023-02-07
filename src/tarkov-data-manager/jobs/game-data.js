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
        this.logger.log('Running update-tc-data...');
        await this.jobManager.runJob('update-tc-data', {parent: this});
        this.logger.log('Completed update-tc-data');

        this.logger.log('Running updateNewItems...');
        await this.jobManager.runJob('update-new-items', {parent: this});
        this.logger.log('Completed updateNewItems');

        this.logger.log('Running updateItemNames...');
        await this.jobManager.runJob('update-item-names', {parent: this});
        this.logger.log('Completed updateItemNames');

        this.logger.log('Running updateTypes...');
        await this.jobManager.runJob('update-types', {parent: this});
        this.logger.log('Completed updateTypes');

        this.logger.log('Updating handbook...');
        await tarkovData.handbook(true);
        this.logger.log('Completed updating handbook');
        connection.keepAlive = keepAlive;
    }
}

module.exports = GameDataJob;
