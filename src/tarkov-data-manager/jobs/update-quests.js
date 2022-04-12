const fs = require('fs');
const path = require('path');

const got = require('got');
const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');

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
    let data;

    try {
        data = await got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/quests.json', {
            responseType: 'json',
        });
    } catch (dataError){
        logger.error('Error retrieving quests.json');
        logger.error(dataError);
        logger.end();
        return false;
    }

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

    try {
        fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'quests.json'), JSON.stringify(quests, null, 4));
    } catch (writeError){
        logger.error('Error writing quests.json dump');
        logger.error(writeError);
    }

    try {
        const response = await cloudflare(`/values/QUEST_DATA`, 'PUT', JSON.stringify(quests));
        if (response.success) {
            logger.success('Successful Cloudflare put of QUEST_DATA');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
        }
        for (let i = 0; i < response.messages.length; i++) {
            logger.error(response.messages[i]);
        }
    } catch (requestError){
        logger.error(requestError);
    }
    logger.end();
}