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
        const results = await Promise.all([
            module.exports.items(true), 
            module.exports.crafts(true),
            module.exports.credits(true),
            module.exports.en(true)
        ]);
        return {
            items: results[0],
            crafts: results[1],
            credits: results[2],
            en: results[3]
        };
    }
}