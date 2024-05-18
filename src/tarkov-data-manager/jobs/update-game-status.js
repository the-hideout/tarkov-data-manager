const tarkovData = require('../modules/tarkov-data');
const DataJob = require('../modules/data-job');

const statusMap = [
    'OK',
    'Updating',
    'Unstable',
    'Down',
];

class UpdateGameStatusJob extends DataJob {
    constructor() {
        super('update-game-status');
        this.kvName = 'status_data';
    }

    async run() {
        const status = await tarkovData.status(true);

        if (status.global.message === 'Access denied' && status.global.status !== null && status.global.status !== undefined) {
            status.global.message = ''
        }

        const generalStatus = {
            name: 'Global',
            message: status.global.message,
            status: status.global.status,
            statusCode: statusMap[status.global.status],
        };
         
        this.kvData = {
            ServerStatus: {
                generalStatus,
                currentStatuses: [...status.services.map((serviceStatus) => {
                    return {
                        ...serviceStatus,
                        statusCode: statusMap[serviceStatus.status],
                    };
                }), generalStatus],
                messages: status.messages.map((message) => {
                    return {
                        ...message,
                        statusCode: statusMap[message.type],
                    };
                }),
            }
        };
        await this.cloudflarePut();
        return this.kvData;
    }
}

module.exports = UpdateGameStatusJob;
