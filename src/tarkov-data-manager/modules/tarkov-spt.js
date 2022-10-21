const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');

const got = require('got');

const sptLangs = {
    //'en': 'en',
    'es': 'es',
    'de': 'ge',
    'fr': 'fr',
    'cz': 'cz',
    'hu': 'hu',
    'it': 'it',
    'jp': 'jp',
    'pl': 'pl',
    'pt': 'po',
    //'ru': 'ru',
    'sk': 'sk',
    'tr': 'tu',
    'zh': 'ch',
}

const cachePath = (filename) => {
    return path.join(__dirname, '..', 'cache', filename);   
}

const downloadJson = async (fileName, path, download = false) => {
    if (download) {
        returnValue = await got(path, {
            responseType: 'json',
            resolveBodyOnly: true,
        });
        fsSync.writeFileSync(cachePath(fileName), JSON.stringify(returnValue, null, 4));
        return returnValue;
    }
    try {
        return JSON.parse(await fs.readFile(cachePath(fileName)));
    } catch (error) {
        if (error.code === 'ENOENT') {
            return downloadJson(fileName, path, true);
        }
        return Promise.reject(error);
    }
};

const getLocale = async (locale, download) => {
    if (sptLangs[locale]) {
        locale = sptLangs[locale];
    }
    return downloadJson(`locale_${locale}.json`, `https://dev.sp-tarkov.com/SPT-AKI/Server/raw/branch/development/project/assets/database/locales/global/${locale}.json`, download);
};

const getLocales = async (download) => {
    const langCodes = Object.keys(sptLangs);
    const localePromises = [];
    for (const locale of langCodes) {
        localePromises.push(getLocale(locale, download).then(localeData => {
            return {
                locale: locale,
                data: localeData
            }
        }));
    }
    const translations = await Promise.all(localePromises);
    const locales = {};
    for (const localeData of translations) {
        locales[localeData.locale] = localeData.data;
    }
    return locales;
};

module.exports = {
    handbook: (download) => {
        return downloadJson('handbook.json', 'https://dev.sp-tarkov.com/SPT-AKI/Server/raw/branch/development/project/assets/database/templates/handbook.json', download);
    },
    locale: getLocale,
    locales: getLocales,
    quests: (download) => {
        return downloadJson('quests.json', 'https://dev.sp-tarkov.com/SPT-AKI/Server/raw/branch/development/project/assets/database/templates/quests.json', download);
    },
};
