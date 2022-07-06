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

module.exports = async (data, logger) => {
    let closeLogger = true;
    let quests = [];
    if (!logger) {
        logger = new JobLogger('update-quests-legacy');
        logger.log('Running update-quests-legacy...');
        closeLogger = false;
    }
    try {
        if (!data) {
            logger.log('Retrieving tarkovdata quests.json...');
            data = await got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/quests.json', {
                responseType: 'json',
                resolveBodyOnly: true
            });
        }
        logger.log('Processing tarkovdata quests.json...');

        quests = data.map((quest) => {
            const parsedQuest = {
                ...quest,
                requirements: quest.require,
                wikiLink: quest.wiki,
                reputation: quest.reputation.map((reputationData) => {
                    return {
                        trader: reputationData.trader,
                        amount: reputationData.rep,
                    };
                }),
                objectives: quest.objectives.map((objectiveData) => {
                    const formattedObjective = {
                        ...objectiveData,
                    };

                    if(objectiveData.type === 'collect' || objectiveData.type === 'find' || objectiveData.type === 'place'){
                        formattedObjective.targetItem = formattedObjective.target;

                        /*if(!formattedObjective.targetItem.id){
                            //console.log(`${quest.id} - ${formattedObjective.target}`);
                            formattedObjective.targetItem = null;
                        }*/
                    } else if (objectiveData.type === 'mark') {
                        formattedObjective.targetItem = formattedObjective.tool;

                        /*if(!formattedObjective.targetItem.id){
                            //console.log(`${quest.id} - ${formattedObjective.tool}`);
                            formattedObjective.targetItem = null;
                        }*/
                    }

                    if(!Array.isArray(formattedObjective.target)){
                        formattedObjective.target = [formattedObjective.target];
                    }

                    return formattedObjective;
                }),
            };
            delete parsedQuest.require;
            delete parsedQuest.wiki;
            delete parsedQuest.locales;

            parsedQuest.requirements.quests = parsedQuest.requirements.quests.map((stringOrArray) => {
                if(Array.isArray(stringOrArray)){
                    return stringOrArray;
                }

                return [stringOrArray];
            });

            if(quest.require.quests.length === 0){
                parsedQuest.requirements.prerequisiteQuests = [[]];
                return parsedQuest;
            }

            let questsList = [];

            for(const questList of quest.require.quests){
                questsList.push(questList.map((id) => {
                    return id;
                }));
            }

            parsedQuest.requirements.prerequisiteQuests = questsList;

            return parsedQuest;
        });

        /*const response = await cloudflare.put('quest_data', JSON.stringify({
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
        }*/

    } catch (error){
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
        return Promise.reject(error);
    }
    if (closeLogger) logger.end();
    return quests;
}
