const got = require('got');
const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

module.exports = async () => {
    const logger = new JobLogger('update-hideout-legacy');    
    try {
        const data = await got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/hideout.json', {
            responseType: 'json',
        });
        const hideoutData = {
            updated: new Date(),
            data: data.body.modules,
        };

        const response = await cloudflare(`/values/HIDEOUT_DATA`, 'PUT', JSON.stringify(hideoutData)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of HIDEOUT_DATA');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                logger.error(response.messages[i]);
            }
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