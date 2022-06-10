const got = require('got');

const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

const traderMap = [
    'prapor',
    'therapist',
    'fence',
    'skier',
    'peacekeeper',
    'mechanic',
    'ragman',
    'jaeger',
];

module.exports = async () => {
    const logger = new JobLogger('update-quests');
    try {
        logger.log('Retrieving TarkovTracker quests.json...');
        const data = await got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/quests.json', {
            responseType: 'json',
        });

        const quests = data.body.map((quest) => {
            return {
                ...quest,
                reputation: quest.reputation.map((questReputation) => {
                    return {
                        ...questReputation,
                        trader: traderMap[questReputation.trader],
                    };
                }),
            };
        });

        const response = await cloudflare('quest_data', 'PUT', JSON.stringify({
            updated: new Date(),
            data: quests,
        })).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of quest_data');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
        }
        for (let i = 0; i < response.messages.length; i++) {
            logger.error(response.messages[i]);
        }
    } catch (error){
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
}