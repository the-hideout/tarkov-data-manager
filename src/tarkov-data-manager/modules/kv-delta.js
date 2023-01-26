//const { fork } = require('child_process');
const fs = require('fs');

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

function addDiff(diffs, dataType, value = false) {
    const purgeName = aliases[dataType] ? aliases[dataType] : dataType;
    if (!diffs[purgeName]) {
        diffs[purgeName] = [];
    }
    if (ignoreId.includes(purgeName)) {
        return;
    }
    if (value) {
        diffs[purgeName].push(value);
    }
}

module.exports = async (outputFile, logger) => {
    if (!logger) {
        logger = {
            ...console,
            success: console.log,
        };
    }
    let newData = {};
    let oldData = {};

    let diffs = {};
    const start = new Date();
    try {
        oldData = JSON.parse(fs.readFileSync(`./dumps/${outputFile}_old.json`));
    } catch (error) {
        // do nothing
    }
    try {
        newData = JSON.parse(fs.readFileSync(`./dumps/${outputFile}.json`));
        for (const dataType in oldData) {
            if (ignoreTypes.includes(dataType)) {
                continue;
            }
            const oldD = oldData[dataType];
            const newD = newData[dataType];
            if (!newD) {
                diffs[dataType] = [];
                continue;
            }
            for (const key in oldD) {
                const oldValue = oldD[key];
                let newValue = Array.isArray(newD) && key < newD.length ? newD[key] : false;
                let id = false;
                if (!Array.isArray(newD)) {
                    newValue = newD[key];
                    if (typeof oldValue.id !== 'undefined') {
                        id = oldValue.id;
                    }
                }
                if (Array.isArray(oldD) && Array.isArray(newD) && typeof oldValue.id !== 'undefined') {
                    id = oldValue.id;
                    newValue = newD.find(val => val.id === id);
                }
                if (!newValue) {
                    //console.log('newValue does not exist for', oldValue);
                    addDiff(diffs, dataType, id);
                    continue;
                }
                if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
                    //console.log('newValue !== oldValue', id, newValue, oldValue);
                    addDiff(diffs, dataType, id);
                }
            }
            for (const key in newD) {
                const newValue = newD[key];
                let oldValue = Array.isArray(oldD) && key < oldD.length ? oldD[key] : false;
                let id = false;
                if (!Array.isArray(oldD)) {
                    oldValue = oldD[key];
                    if (typeof newValue.id !== 'undefined') {
                        id = newValue.id;
                    }
                }
                if (Array.isArray(oldD) && Array.isArray(newD) && typeof newValue.id !== 'undefined') {
                    id = newValue.id;
                    oldValue = oldD.find(val => val.id === id);
                }
                if (!oldValue) {
                    addDiff(diffs, dataType, id);
                }
            }
        }
        logger.log(`${outputFile} diff generated in ${new Date() - start} ms`);
    } catch (error) {
        logger.error(`Error getting KV delta: ${error.message}`);
    }
    return {purge: diffs, updated: new Date(newData.updated)};
};

/*module.exports = async (outputFile, logger) => {
    if (!logger) {
        logger = {
            ...console,
            success: console.log,
        };
    } else {
        logger.write('Processed main data in', true);
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
};*/
