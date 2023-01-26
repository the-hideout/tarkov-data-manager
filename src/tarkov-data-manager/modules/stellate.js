const got = require('got');

const kvDelta = require('./kv-delta');

async function purgeTypes(dataName, logger = false) {
    const {purge, updated} = await kvDelta(dataName, logger);
    let delay = 60000 - (new Date() - updated);
    delay = delay > 0 ? delay : 0;
    if (!process.env.STELLATE_PURGE_TOKEN) {
        return;
    }
    if (Object.keys(purge).length === 0) {
        if (logger) {
            logger.log('Nothing to purge from cache');
        }
        return;
    }
    for (const t in purge) {
        purge[t] = purge[t].map(val => `"${val}"`);
    }
    let url = 'https://admin.stellate.co/tarkov-dev-api';
    if (process.env.NODE_ENV === 'dev') {
        url += '-dev';
        delay = 0; // if we're in dev mode, don't delay the purge
    }
    if (delay) {
        logger.log(`Purging cache in ${delay} ms`)
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
                    body: JSON.stringify({ query: `mutation { ${Object.keys(purge).map(t => `purge${t}(${purge[t].length > 0 ? `id: [${purge[t].join(', ')}] ` : ''}soft: true)`).join(' ')} }` }),
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
                logger.log(`Purged cache for: ${Object.keys(response.data).map(key => key.replace(/^purge/, '')).map(type => `${type}${purge[type].length > 0 ? ` (${purge[type].length})` : '' }`).join(', ')}`);
            }
            resolve();
        }, delay * 1000);
    });
}

module.exports = {
    purgeTypes
};
