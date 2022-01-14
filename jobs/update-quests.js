const fs = require('fs');
const path = require('path');

const got = require('got');
const cloudflare = require('../modules/cloudflare');


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
    let data;

    try {
        data = await got('https://raw.githack.com/TarkovTracker/tarkovdata/master/quests.json', {
            responseType: 'json',
        });
    } catch (dataError){
        console.error(dataError);

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
        console.error(writeError);
    }

    try {
        const response = await cloudflare(`/values/QUEST_DATA`, 'PUT', JSON.stringify(quests));
        console.log(response);
    } catch (requestError){
        console.error(requestError);
    }
}