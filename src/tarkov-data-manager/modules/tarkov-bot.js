const fs = require('fs');
const path = require('path');

const got = require('got');

const dataTypes = {
    'items': 'items-tb.json',
    'prices': 'credits-tb.json',
    'dictionary': 'locale_{{lang}}.json',
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

const jsonRequest = async (dataType, params, logger = false) => {
    if (!process.env.TB_URL || !process.env.TB_KEY) {
        return Promise.reject(new Error('TB_URL or TB_KEY not set'));
    }
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

    const rateLimitMessage = 'Tarkov-Bot rate-hour-limit: '+response.headers['rate-hour-limit'];
    const remainingMessage = 'Tarkov-Bot rate-hour-left: '+response.headers['rate-hour-left'];
    if (logger) {
        logger.log(rateLimitMessage);
        logger.log(remainingMessage);
    } else {
        console.log(rateLimitMessage);
        console.log(remainingMessage);
    }
    if (response.body.err === 'Rate limits exceeded') return Promise.reject(new Error('Tarkov-Bot rate limits exceeded'));
    return response.body;
};

const cachePath = (filename) => {
    return path.join(__dirname, '..', 'cache', filename);   
}

module.exports = {
    get: async (dataType, download = false, params = {}, logger = false) => {
        let saveFileName = dataTypes[dataType];
        if (dataType === 'dictionary') {
            if (!params.lang) {
                return Promise.reject(new Error('You must specify a lang value in the params argument to request a dictionary'));
            }
            let isoLang = false;
            for (const isoCode in langs) {
                if (langs[isoCode] === params.lang) {
                    isoLang = isoCode;
                    break;
                }
            }
            if (!isoLang) {
                return Promise.reject(new Error(`${params.lang} is not a recognized lang value`));
            }
            saveFileName = saveFileName.replace('{{lang}}', isoLang)
        }
        if (!dataTypes[dataType]) return Promise.reject(new Error(`${dataType} is not a valid request for Tarkov-Bot`));
        let returnValue = false;
        if (download) {
            returnValue = await jsonRequest(dataType, params, logger);
            fs.writeFileSync(cachePath(saveFileName || dataTypes[dataType]), JSON.stringify(returnValue, null, 4));
            return returnValue;
        }
        try {
            return JSON.parse(fs.readFileSync(cachePath(saveFileName || dataTypes[dataType])));
        } catch (error) {
            if (error.code === 'ENOENT') {
                return module.exports.get(dataType, true, params, logger);
            }
            return Promise.reject(error);
        }
    },
    items: async (download = false, logger = false) => {
        return module.exports.get('items', download, false, logger);
    },
    prices: async (download = false, logger = false) => {
        return module.exports.get('prices', download, false, logger);
    },
    locale: (lang = 'ru', download = false, logger = false) => {
        return module.exports.get('dictionary', download, {lang: langs[lang]}, logger);
    },
    locales: async (download = false, logger = false) => {
        const promises = [];
        for (const lang in langs) {
            promises.push(module.exports.get('dictionary', download, {lang: langs[lang]}, logger).then(data => {
                return {lang: lang, data: data};
            }).catch(error => {
                return Promise.reject({lang: lang, error: error});
            }));
        }
        const results = await Promise.allSettled(promises);
        returnVal = {};
        for (const result of results) {
            if (result.status === 'rejected') {
                const message = `Error updating ${result.reason.lang} locale: ${result.reason.error}`;
                if (logger) {
                    logger.error(message);
                } else {
                    console.log(error);
                }
                continue;
            }
            const lang = result.value;
            returnVal[lang.lang] = lang.data;
        }
        return returnVal;
    },
}
