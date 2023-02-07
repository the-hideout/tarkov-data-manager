const got = require('got');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const DataJob = require('../modules/data-job');

class UpdateHideoutLegacyJob extends DataJob {
    constructor() {
        super('update-hideout-legacy');
    }

    async run(options) {
        const hideout = [];
        let data = options?.data;
        if (!data) {
            this.logger.log('Retrieving tarkovdata hideout.json...');
            data = await got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/hideout.json', {
                responseType: 'json',
                resolveBodyOnly: true
            });
        }
        this.logger.log('Processing tarkovdata hideout.json...');
        for (const hideoutModule of data.modules) {
            const newRequirement = {
                id: hideoutModule.id,
                name: hideoutModule.module,
                level: hideoutModule.level,
                itemRequirements: hideoutModule.require.map((hideoutRequirement) => {
                    if(hideoutRequirement.type !== 'item'){
                        return false;
                    }

                    return {
                        item: hideoutRequirement.name,
                        quantity: hideoutRequirement.quantity,
                        count: hideoutRequirement.quantity,
                    };
                }),
                moduleRequirements: hideoutModule.require.map((hideoutRequirement) => {
                    if(hideoutRequirement.type !== 'module'){
                        return false;
                    }

                    return {
                        name: hideoutRequirement.name,
                        level: hideoutRequirement.quantity,
                    };
                }).filter(Boolean),
            };

            newRequirement.itemRequirements = newRequirement.itemRequirements.filter(Boolean);
            hideout.push(newRequirement);
        }
        return hideout;
    }
}

module.exports = UpdateHideoutLegacyJob;
