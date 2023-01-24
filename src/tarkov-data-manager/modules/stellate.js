const got = require('got');

async function purgeTypes(types, logger = false, delay = 60) {
    if (!process.env.STELLATE_PURGE_TOKEN) {
        return;
    }
    // if we're delaying the purge; write the rest of the job log
    if (logger && delay) {
        logger.write();
    }
    if (typeof types === 'string') {
        types = {types: []};
    }
    if (Array.isArray(types)) {
        types = types.reduce((allTypes, current) => {
            allTypes[current] = [];
            return allTypes;
        }, {});
    }
    for (const t in types) {
        types[t] = types[t].map(val => `"${val}"`);
    }
    let url = 'https://admin.stellate.co/tarkov-dev-api';
    if (process.env.NODE_ENV === 'dev') {
        url += '-dev';
        delay = 0; // if we're in dev mode, don't delay the purge
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
                    body: JSON.stringify({ query: `mutation { ${Object.keys(types).map(t => `purge${t}(${types[t].length > 0 ? `id: [${types[t].join(', ')}] ` : ''}soft: true)`).join(' ')} }` }),
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
