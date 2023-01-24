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
    const newData = JSON.parse(process.env.newData);

    let diffs = {};
    const start = new Date();
    try {
        //newData = JSON.parse(JSON.stringify(newData));
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
        process.send({level: 'log', message: `${outputFile} diff generated in ${new Date() - start} ms`})
    } catch (error) {
        process.send({level: 'error', message: `Error getting KV delta: ${error.message}`, error: error});
    }
    process.send({level: 'log', message: 'complete', diff: diffs});
})();
