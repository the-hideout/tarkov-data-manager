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
        let globalStatus = {
            message: 'N/A',
            status: 2,
        };

        const status = await tarkovData.status(true);

        let globalStatusMessage = status.global.message;
        if (globalStatusMessage === 'Access denied' && status.global.status !== null && status.global.status !== undefined) {
            globalStatusMessage = ''
        }

        const generalStatus = {
            name: 'Global',
            message: globalStatusMessage,
            status: globalStatus.status,
            statusCode: statusMap[globalStatus.status],
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
    }
}

module.exports = UpdateGameStatusJob;
