const fs = require('fs');
const path = require('path');

const got = require('got');

const tarkovBot = require('../modules/tarkov-bot');

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
    locale_en: {
        requestName: 'locale_en_td.json',
        fileName: 'locale_en.json'
    },
    locale_ru: {
        requestName: 'locale_ru_td.json',
        fileName: 'locale_ru.json'
    },
    locale_de: {
        requestName: 'locale_ge_td.json',
        fileName: 'locale_de.json'
    },
    locale_fr: {
        requestName: 'locale_fr_td.json',
        fileName: 'locale_fr.json'
    },
    locale_cz: {
        requestName: 'locale_cz_td.json',
        fileName: 'locale_cz.json'
    },
    locale_hu: {
        requestName: 'locale_hu_td.json',
        fileName: 'locale_hu.json'
    },
    locale_tr: {
        requestName: 'locale_tr_td.json',
        fileName: 'locale_tr.json'
    },
    locale_zh: {
        requestName: 'locale_zh_td.json',
        fileName: 'locale_zh.json'
    },
    locale_es: {
        requestName: 'locale_es_td.json',
        fileName: 'locale_es.json'
    }
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
        return tarkovBot.locale_en(download, 'locale_en.json');
        //return module.exports.get('locale_en_td.json', download, 'locale_en.json');
    },
    locale: async (download = false, lang = 'en') => {
        return tarkovBot.dictionary(download, `locale_${lang}.json`, lang);
    },
    locale_es: async (download = false) => {
        return module.exports.locale(download, 'es');
    },
    locale_ru: async (download = false) => {
        return module.exports.locale(download, 'ru');
    },
    locale_de: async (download = false) => {
        return module.exports.locale(download, 'de');
    },
    locale_fr: async (download = false) => {
        return module.exports.locale(download, 'fr');
    },
    locale_cz: async (download = false) => {
        return module.exports.locale(download, 'cz');
    },
    locale_hu: async (download = false) => {
        return module.exports.locale(download, 'hu');
    },
    locale_tr: async (download = false) => {
        return module.exports.locale(download, 'tr');
    },
    locale_zh: async (download = false) => {
        return module.exports.locale(download, 'zh');
    },
    locales: async (download = false) => {
        const langs = await Promise.all([
            module.exports.locale_en().then(data => {return {lang: 'en', data: data}}),
            module.exports.locale_es().then(data => {return {lang: 'es', data: data}}),
            module.exports.locale_ru().then(data => {return {lang: 'ru', data: data}}),
            module.exports.locale_de().then(data => {return {lang: 'de', data: data}}),
            module.exports.locale_fr().then(data => {return {lang: 'fr', data: data}}),
            module.exports.locale_cz().then(data => {return {lang: 'cz', data: data}}),
            module.exports.locale_hu().then(data => {return {lang: 'hu', data: data}}),
            module.exports.locale_tr().then(data => {return {lang: 'tr', data: data}}),
            module.exports.locale_zh().then(data => {return {lang: 'zh', data: data}})
        ]);
        returnVal = {};
        for (const lang of langs) {
            returnVal[lang.lang] = lang.data;
        }
        return returnVal;
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
        for (const file in availableFiles) {
            const fileSource = availableFiles[file].requestName;
            console.log(fileSource);
            //promises.push(module.exports.get(fileSource, true, availableFiles[file]).then(data => {return {name: availableFiles[fileSource] || fileSource, data: data}}));
            promises.push(module.exports[file](true, availableFiles[file]).then(data => {return {name: availableFiles[fileSource] || fileSource, data: data}}));
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