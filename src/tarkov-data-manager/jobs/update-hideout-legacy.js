const got = require('got');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

module.exports = async (data, logger) => {
    let hideout = [];
    let closeLogger = false;
    if (!logger) {
        logger = new JobLogger('update-hideout-legacy');
        logger.log('Running update-hideout-legacy...');
        closeLogger = true;
    }
    try {
        if (!data) {
            logger.log('Retrieving tarkovdata hideout.json...');
            data = await got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/hideout.json', {
                responseType: 'json',
                resolveBodyOnly: true
            });
        }
        logger.log('Processing tarkovdata hideout.json...');
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
    } catch (error){
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job; update-hideout-legacy subjob`,
            message: error.toString()
        });
        return Promise.reject(error);
    }
    if (closeLogger) logger.end();
    return hideout;
}
