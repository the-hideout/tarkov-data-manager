const fs = require('fs');
const path = require('path');

const got = require('got');

const jsonRequest = async (path) => {
    const response = await got(process.env.TC_URL+path, {
        method: 'post',
        username: process.env.TC_USERNAME,
        password: process.env.TC_PASSWORD,
        responseType: 'json',
        headers: {
            'Accept': 'application/json'
        },
        resolveBodyOnly: true,
    });
    if (!response) return Promise.reject(new Error(`Tarkov Changes returned null result for ${path}`));
    return response;
};

const availableFiles = {
    crafts: {
        requestName: 'crafts.json'
    },
    credits: {
        requestName: 'credits.json'
    },
    items: {
        requestName: 'items.json'
    },
    globals: {
        requestName: 'globals.json'
    },
    areas: {
        requestName: 'areas.json'
    },
    traders: {
        requestName: 'traders_clean.json',
        fileName: 'traders.json'
    },
    locations: {
        requestName: 'locations.json'
    },
    locale_en: {
        requestName: 'locale_en_td.json',
        fileName: 'locale_en.json'
    },
};

const cachePath = (filename) => {
    return path.join(__dirname, '..', 'cache', filename);   
}

module.exports = {
    get: async (fileName, download = false, saveFileName = false) => {
        let returnValue = false;
        if (download) {
            returnValue = await jsonRequest(fileName);
            fs.writeFileSync(cachePath(saveFileName || fileName), JSON.stringify(returnValue, null, 4));
            return returnValue;
        }
        try {
            return JSON.parse(fs.readFileSync(cachePath(saveFileName || fileName)));
        } catch (error) {
            if (error.code === 'ENOENT') {
                return module.exports.get(fileName, true, saveFileName);
            }
            return Promise.reject(error);
        }
    },
    items: async (download = false) => {
        return module.exports.get('items.json', download);
    },
    crafts: async (download = false) => {
        return module.exports.get('crafts.json', download);
    },
    credits: async (download = false) => {
        return module.exports.get('credits.json', download);
    },
    locale_en: async (download = false) => {
        //return tarkovBot.locale_en(download, 'locale_en.json');
        return module.exports.get('locale_en_td.json', download, 'locale_en.json');
    },
    locations: async (download = false) => {
        return module.exports.get('locations.json', download);
    },
    globals: async(download = false) => {
        return module.exports.get('globals.json', download);
    },
    areas: async(download = false) => {
        return module.exports.get('areas.json', download);
    },
    traders: async (download = false) => {
        return module.exports.get('traders_clean.json', download, 'traders.json');
    },
    downloadAll: async () => {
        const promises = [];
        for (const file in availableFiles) {
            if (availableFiles[file].skip) continue;
            const fileSource = availableFiles[file].requestName;
            console.log(fileSource);
            //promises.push(module.exports.get(fileSource, true, availableFiles[file]).then(data => {return {name: availableFiles[fileSource] || fileSource, data: data}}));
            promises.push(module.exports[file](true, availableFiles[file]).then(data => {return {name: availableFiles[fileSource] || fileSource, data: data}}));
        }
        //promises.push(getSptLocales(true).then(data => {return {name: 'locales', data: data}}));
        const results = await Promise.allSettled(promises);
        const errors = [];
        const values = {};
        for (let i = 0; i < results.length; i++) {
            if (results[i].status === 'fulfilled') {
                values[results[i].value.name] = results[i].value.data;
            } else {
                errors.push(results[i].reason.message);
            }
        }
        if (errors.length > 0) {
            return Promise.reject(new Error(errors.join('; ')));
        }
        return values;
    }
}
