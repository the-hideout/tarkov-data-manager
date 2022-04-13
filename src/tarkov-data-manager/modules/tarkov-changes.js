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

const cachePath = (filename) => {
    return path.join(__dirname, '..', 'cache', filename);   
}

module.exports = {
    get: async (fileName, download = false) => {
        let returnValue = false;
        if (download) {
            returnValue = await jsonRequest(fileName);
            fs.writeFileSync(cachePath(fileName), JSON.stringify(returnValue, null, 4));
            return returnValue;
        }
        try {
            return JSON.parse(fs.readFileSync(cachePath(fileName)));
        } catch (error) {
            if (error.code === 'ENOENT') {
                return module.exports.get(fileName, true);
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
    en: async (download = false) => {
        return module.exports.get('locale_en.json', download);
    },
    downloadAll: async () => {
        const results = await Promise.allSettled([
            module.exports.items(true).then(data => {return {name: 'items', data: data}}), 
            module.exports.crafts(true).then(data => {return {name: 'crafts', data: data}}),
            module.exports.credits(true).then(data => {return {name: 'credits', data: data}}),
            module.exports.en(true).then(data => {return {name: 'en', data: data}})
        ]);
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