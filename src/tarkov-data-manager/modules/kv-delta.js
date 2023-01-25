const { fork } = require('child_process');

const aliases = {
    HandbookCategory: 'ItemCategory',
};

const ignoreTypes = [
    'updated',
    'data',
    'ItemType',
    'LanguageCode',
];

const ignoreId = [
    'Barter',
    'MobInfo',
    'TraderCashOffer',
];

const linkedTypes = {
    TraderCashOffer: ['ItemPrice'],
};

module.exports = async (outputFile, logger) => {
    if (!logger) {
        logger = {
            ...console,
            success: console.log,
        };
    } else {
        logger.write('Processed main data');
    }
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const child = fork('./modules/diff-worker.js', { 
            signal: controller.signal,
            env: {
                outputFile,
            }
        });
        child.on('error', (err) => {
            logger.error(err.message);
            reject(err);
        });
        child.on('message', (message) => {
            if (message.level === 'error') {
                logger.error(message.message);
                return;
            }
            if (message.level === 'warn') {
                logger.warn(message.messsage);
            }
            if (message.level === 'log') {
                if (message.message === 'complete') {
                    const purge = {};
                    for (const rawType in message.diff) {
                        const match = rawType.match(/(?<fieldName>[a-zA-Z0-9]+)(__(?<diffType>[a-z]+))?/);
                        const typeName = match.groups.fieldName;
                        if (ignoreTypes.includes(typeName)) {
                            continue;
                        }
                        const purgeName = aliases[typeName] ? aliases[typeName] : typeName;
                        if (!purge[purgeName]) {
                            purge[purgeName] = [];
                        }
                        if (linkedTypes[typeName]) {
                            for (const linkedType of linkedTypes[typeName]) {
                                if (!purge[linkedType]) {
                                    purge[linkedType] = [];
                                }
                            }
                        }
                        if (ignoreId.includes(typeName)) {
                            continue;
                        }
                        for (const diff of message.diff[rawType]) {
                            if (diff.id) {
                                purge[purgeName].push(diff.id);
                            }
                        }
                    }
                    return resolve({purge, updated: new Date(message.updated)});
                }
                logger.log(message.message);
            }
        });
    });
};

/*const fs = require('fs');

const jsonDiff = require('json-diff');

function getRealDiffs(object) {
    if (typeof object !== 'object') {
        return object;
    }
    if (Array.isArray(object)) {
        object = object.map(element => {
            if (!Array.isArray(element)) {
                return element;
            }
            if (element[0] === ' ') {
                return false;
            }
            return element[1];
        }).filter(Boolean);
    }
    return object;
}

module.exports = (outputFile, newData, logger) => {
    if (!logger) {
        logger = {
            ...console,
            success: console.log,
        };
    }
    let diffs = {};
    const start = new Date();
    try {
        newData = JSON.parse(JSON.stringify(newData));
        const json = JSON.parse(fs.readFileSync(`./dumps/${outputFile}.json`));
        diffs = jsonDiff.diff(json, newData, {outputKeys: ['id']});
        delete diffs.updated;
        delete diffs.updated__deleted;
        for (const key in diffs) {
            if (Array.isArray(diffs[key])) {
                diffs[key] = getRealDiffs(diffs[key]);
            } else {
                diffs[key] = Object.values(diffs[key]);
            }
            for (let diff of diffs[key]) {
                diff = getRealDiffs(diff);
            }
            diffs[key] = diffs[key].filter(diff => {
                if (Object.keys(diff).length === 1 && diff.id) {
                    return false;
                }
                return true;
            });
            if (diffs[key].length === 0) {
                delete diffs[key];
            }
        }
        logger.log(`${outputFile} diff generated in ${new Date() - start} ms`)
    } catch (error) {
        console.log('Error getting KV delta', error);
        logger.warn(`Could not parse ${outputFile}`);
    }
    return diffs;
};*/
