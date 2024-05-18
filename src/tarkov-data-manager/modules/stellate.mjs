import got from 'got';

import kvDelta from './kv-delta.js';

const ignoreData = [
    'schema_data',
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
        purgeBody.push(`${Object.keys(types).map(t => 
            `${t}: _purgeType(type: "${t}",${types[t].length > 0 ? ` keyFields: [${types[t].map(val => `{name: "id", value: ${val}}`).join(', ')}],` : ''} soft: true)`).join(' ')}`
        );
    }
    if (queries.length > 0) {
        purgeBody.push((`_purgeQuery(queries: [${queries.join(', ')}], soft: true)`));
    }
    let url = 'https://admin.stellate.co/tarkov-dev-api';
    if (process.env.NODE_ENV !== 'production') {
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
                logger.error(`Error purging ${dataName} cache: ${response.errors.map(err => err.message || err).join(', ')}`);
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
                    purgeSummary.push(`${purgeAction}${types[purgeAction].length > 0 ? ` (${types[purgeAction].length})` : '' }`);
                }
                logger.log(`Purged cache for: ${purgeSummary.join(', ')}`);
            }
            resolve();
        }, delay);
    });
}

const stellate = {
    purge
};

export default stellate;
