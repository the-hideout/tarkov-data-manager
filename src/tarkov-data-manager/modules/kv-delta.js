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

module.exports = (outputFile, newData, logger) => {
    if (!logger) {
        logger = {
            ...console,
            success: console.log,
        };
    }
    let diffs = {};
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
    } catch (error) {
        console.log('Error getting KV delta', error);
        logger.warn(`Could not parse ${outputFile}`);
    }
    return diffs;
};
