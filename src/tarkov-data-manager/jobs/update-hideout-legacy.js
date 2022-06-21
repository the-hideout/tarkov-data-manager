const got = require('got');
const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

module.exports = async (data, logger) => {
    let hideout = [];
    let closeLogger = true;
    if (!logger) {
        logger = new JobLogger('update-hideout-legacy');
        logger.log('Running update-hideout-legacy...');
        closeLogger = false;
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
        /*const hideoutData = {
            updated: new Date(),
            data: data.body.modules,
        };

        const response = await cloudflare.put('hideout_legacy_data', JSON.stringify(hideoutData)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of legacy hideout_legacy_data');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                logger.error(response.messages[i]);
            }
        }*/
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
