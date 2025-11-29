import tarkovData from '../modules/tarkov-data.mjs';
import DataJob from '../modules/data-job.mjs';

const statusMap = [
    'OK',
    'Updating',
    'Unstable',
    'Down',
];

class UpdateGameStatusJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-game-status'});
        this.kvName = 'status_data';
    }

    async run() {
        let status;
        try {
            status = await tarkovData.status({download: true});
        } catch (error) {
            this.logger.log(error.message);
            return;
        }

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

export default UpdateGameStatusJob;
