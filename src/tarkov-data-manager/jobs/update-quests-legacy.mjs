import got from 'got';

import DataJob from '../modules/data-job.mjs';

class UpdateQuestsLegacyJob extends DataJob {
    constructor() {
        super('update-quests-legacy');
    }

    async run(options) {
        let quests = [];
        let data = options?.data;
        if (!data) {
            this.logger.log('Retrieving tarkovdata quests.json...');
            data = await got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/quests.json', {
                responseType: 'json',
                resolveBodyOnly: true
            });
        }
        this.logger.log('Processing tarkovdata quests.json...');

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

        this.logger.log(`Processed ${quests.length} tarkovdata quests`);
        return quests;
    }
}

export default UpdateQuestsLegacyJob;
