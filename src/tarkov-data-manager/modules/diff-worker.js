const fs = require('fs');

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

function getFullDiffs(oldData, newData) {
    const diffs = jsonDiff.diff(oldData, newData, {outputKeys: ['id']});
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
    return diffs;
}

const ignoreTypes = [
    'updated',
    'data',
    'ItemType',
    'LanguageCode',
];

function addDiff(diffs, dataType, value = false) {
    if (!diffs[dataType]) {
        diffs[dataType] = [];
    }
    if (value) {
        if (typeof value === 'string') {
            value = {id: value};
        }
        diffs[dataType].push(value);
    }
}

function getAnyDiffs(oldData, newData) {
    const diffs = {};
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
    return diffs;
}

const triggerShutdown = async () => {
    process.send({level: 'warn', message: `Diff worker terminated`});
    process.exit();
};

(async () => {
    //gracefully shutdown on Ctrl+C
    process.on( 'SIGINT', triggerShutdown);
    //gracefully shutdown on Ctrl+Break
    process.on( 'SIGBREAK', triggerShutdown);
    //try to gracefully shutdown on terminal closed
    process.on( 'SIGHUP', triggerShutdown);
    
    const outputFile = process.env.outputFile;
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
        diffs = getAnyDiffs(oldData, newData);
        process.send({level: 'log', message: `${outputFile} diff generated in ${new Date() - start} ms`})
    } catch (error) {
        process.send({level: 'error', message: `Error getting KV delta: ${error.message}`, error: error});
    }
    process.send({level: 'log', message: 'complete', diff: diffs, updated: newData.updated});
})();
