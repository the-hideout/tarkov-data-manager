const got = require('got');

async function purgeTypes(types, logger = false, delay = 60) {
    if (!process.env.STELLATE_PURGE_TOKEN) {
        return;
    }
    if (logger) {
        logger.write();
    }
    if (typeof types === 'string') {
        types = [types];
    }
    let url = 'https://admin.stellate.co/tarkov-dev-api';
    if (process.env.NODE_ENV === 'dev') {
        url += '-dev';
    }
    return new Promise(resolve => {
        setTimeout(async () => {
            let response = {};
            try {    
                response = await got(url, { 
                    // Always use POST for purge mutations
                    method: 'POST',
                    headers: {
                        // and specify the Content-Type
                        'Content-Type': 'application/json',
                        'stellate-token': process.env.STELLATE_PURGE_TOKEN,
                    },
                    body: JSON.stringify({ query: `mutation { ${types.map(t => `purge${t}(soft: true)`).join(' ')} }` }),
                    responseType: 'json',
                    resolveBodyOnly: true,
                });
            } catch (error) {
                response = {
                    errors: [error],
                };
            }
            if (response.errors && response.errors.length > 0) {
                logger.error(`Error purging cache: ${response.errors.map(err => err.message).join(', ')}`);
            }
            if (response.data) {
                logger.log(`Purged cache for: ${Object.keys(response.data).map(key => key.replace(/^purge/, '')).join(', ')}`);
            }
            resolve();
        }, delay * 1000);
    });
}

module.exports = {
    purgeTypes
};