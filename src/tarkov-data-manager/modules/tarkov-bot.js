const fs = require('fs');
const path = require('path');

const got = require('got');

const dataTypes = {
    'items': 'tb-items.json',
    'prices': 'tb-prices.json',
    'dictionary': 'tb-en.json',
};

const langs = {
    //'en': 'en',
    'es': 'es',
    'ru': 'ru',
    'de': 'ge',
    'fr': 'fr',
    'cz': 'cz',
    'hu': 'hu',
    'tr': 'tu',
    'zh': 'ch',
}

const jsonRequest = async (dataType, params) => {
    const response = await got(process.env.TB_URL, {
        searchParams: {
            api_key: process.env.TB_KEY,
            data_type: dataType,
            ...params
        },
        responseType: 'json',
        //throwHttpErrors: false
    });
    if (!response.body) return Promise.reject(new Error(`Tarkov-Bot returned null result for ${path}`));
    console.log('Tarkov-Bot rate-hour-limit: '+response.headers['rate-hour-limit']);
    console.log('Tarkov-Bot rate-hour-left: '+response.headers['rate-hour-left']);
    if (response.body.err === 'Rate limits exceeded') return Promise.reject(new Error('Tarkov-Bot rate limits exceeded'));
    return response.body;
};

const cachePath = (filename) => {
    return path.join(__dirname, '..', 'cache', filename);   
}

module.exports = {
    get: async (dataType, download = false, saveFileName = false, params = {}) => {
        if (!dataTypes[dataType]) return Promise.reject(new Error(`${dataType} is not a valid request for Tarkov-Bot`));
        let returnValue = false;
        if (download) {
            returnValue = await jsonRequest(dataType, params);
            fs.writeFileSync(cachePath(saveFileName || dataTypes[dataType]), JSON.stringify(returnValue, null, 4));
            return returnValue;
        }
        try {
            return JSON.parse(fs.readFileSync(cachePath(saveFileName || dataTypes[dataType])));
        } catch (error) {
            if (error.code === 'ENOENT') {
                return module.exports.get(dataType, true);
            }
            return Promise.reject(error);
        }
    },
    items: async (download = false, saveFileName = false) => {
        return module.exports.get('items', download, saveFileName);
    },
    prices: async (download = false, saveFileName = false) => {
        return module.exports.get('prices', download, saveFileName);
    },
    locale_en: async (download = false, saveFileName = false) => {
        return module.exports.get('dictionary', download, saveFileName);
    },
    dictionary: async (download = false, saveFileName = false, lang = 'en') => {
        return module.exports.get('dictionary', download, saveFileName, {lang: langs[lang]});
    },
    locales: async (download = false) => {
        const promises = [];
        for (const lang in langs) {
            promises.push(module.exports.dictionary(download, `locale_${lang}.json`, langs[lang]).then(data => {return {lang: lang, data: data}}))
        }
        const results = await Promise.all(promises);
        returnVal = {};
        for (const lang of results) {
            returnVal[lang.lang] = lang.data;
        }
        return returnVal;
    },
}
