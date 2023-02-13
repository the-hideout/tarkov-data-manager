const got = require('got');

const kvDelta = require('./kv-delta');

const ignoreData = [
    'schema_data'
];

async function purge(dataName, logger = false) {
    if (ignoreData.includes(dataName)) {
        return;
    }
    const {types, queries, updated} = await kvDelta(dataName, logger);
    let delay = 60000 - (new Date() - updated);
    delay = delay > 0 ? delay : 0;
    if (!process.env.STELLATE_PURGE_TOKEN) {
        return;
    }
    if (Object.keys(types).length === 0 && queries.length === 0) {
        logger.log('Nothing to purge from cache');
        return;
    }
    const purgeBody = [];
    if (Object.keys(types).length > 0) {
        for (const t in types) {
            types[t] = types[t].map(val => `"${val}"`);
        }
        purgeBody.push(`${Object.keys(types).map(t => `purge${t}(${types[t].length > 0 ? `id: [${types[t].join(', ')}] ` : ''}soft: true)`).join(' ')}`);
    }
    if (queries.length > 0) {
        purgeBody.push((`_purgeQuery(queries: [${queries.join(', ')}], soft: true)`));
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
                    body: JSON.stringify({ query: `mutation { ${purgeBody.join(' ')} }` }),
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
                const purgeSummary = [];
                for (const purgeAction in response.data) {
                    if (purgeAction === '_purgeQuery') {
                        if (response.data[purgeAction]) {
                            purgeSummary.push('queries');
                        }
                        continue;
                    }
                    const dataType = purgeAction.replace(/^purge/, '');
                    purgeSummary.push(`${dataType}${types[dataType].length > 0 ? ` (${types[dataType].length})` : '' }`);
                }
                logger.log(`Purged cache for: ${purgeSummary.join(', ')}`);
            }
            resolve();
        }, delay);
    });
}

module.exports = {
    purge
};
