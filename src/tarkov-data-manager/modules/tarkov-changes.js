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
        }
    });
    if (!response.body) return Promise.reject(new Error(`Tarkov Changes returned null result for ${path}`));
    return response.body;
};

const spt = async (fileName, path) => {
    returnValue = await got(path, {
        responseType: 'json',
    });
    fs.writeFileSync(cachePath(fileName), JSON.stringify(returnValue.body, null, 4));
    return returnValue.body;
};

const availableFiles = {
    'crafts.json': false,
    'credits.json': false,
    'items.json': false,
    'globals.json': false,
    'areas.json': false,
    'locale_en_td.json': 'locale_en.json',
    'traders_clean.json': 'traders.json',
    //'quests.json: false'
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
            return JSON.parse(fs.readFileSync(cachePath(saveFileName)));
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
        return module.exports.get('locale_en_td.json', download, 'locale_en.json');
    },
    globals: async(download = false) => {
        return module.exports.get('globals.json', download);
    },
    areas: async(download = false) => {
        return module.exports.get('areas.json', download);
    },
    quests: async(download = false) => {
        return spt('quests.json', 'https://dev.sp-tarkov.com/SPT-AKI/Server/raw/branch/development/project/assets/database/templates/quests.json');
        //return module.exports.get('quests.json', download);
    },
    traders: async (download = false) => {
        return module.exports.get('traders_clean.json', download, 'traders.json');
    },
    downloadAll: async () => {
        const promises = [];
        for (const fileSource in availableFiles) {
            console.log(fileSource);
            promises.push(module.exports.get(fileSource, true, availableFiles[fileSource]).then(data => {return {name: availableFiles[fileSource] || fileSource, data: data}}));
        }
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