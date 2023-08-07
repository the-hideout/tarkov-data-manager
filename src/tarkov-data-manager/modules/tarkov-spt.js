const fs = require('fs');
const path = require('path');

const got = require('got');

const sptPath = 'https://dev.sp-tarkov.com/SPT-AKI/Server/raw/branch/master/project/assets/';
const sptDataPath = `${sptPath}database/`;
const sptConfigPath = `${sptPath}configs/`;

const sptLangs = {
    //'en': 'en',
    'es': 'es',
    'de': 'ge',
    'fr': 'fr',
    'cs': 'cz',
    'hu': 'hu',
    'it': 'it',
    'ja': 'jp',
    'ko': 'kr',
    'pl': 'pl',
    'pt': 'po',
    'ru': 'ru',
    'sk': 'sk',
    'tr': 'tu',
    'zh': 'ch',
}

const cachePath = (filename) => {
    return path.join(__dirname, '..', 'cache', filename);   
}

const downloadJson = async (fileName, path, download = false, writeFile = true) => {
    if (download) {
        returnValue = await got(path, {
            responseType: 'json',
            resolveBodyOnly: true,
        });
        if (writeFile) {
            fs.writeFileSync(cachePath(fileName), JSON.stringify(returnValue, null, 4));
        }
        return returnValue;
    }
    try {
        return JSON.parse(fs.readFileSync(cachePath(fileName)));
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
    return downloadJson(`locale_${locale}.json`, `${sptDataPath}locales/global/${locale}.json`, download);
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
        return downloadJson('handbook.json', `${sptDataPath}templates/handbook.json`, download);
    },
    locale: getLocale,
    locales: getLocales,
    quests: (download) => {
        return downloadJson('quests.json', `${sptDataPath}templates/quests.json`, download);
    },
    questConfig: (download) => {
        return downloadJson('questConfig.json', `${sptConfigPath}quest.json`, download);
    },
    botInfo: (botKey, download = true) => {
        botKey = botKey.toLowerCase();
        return downloadJson(`${botKey}.json`, `${sptDataPath}bots/types/${botKey}.json`, download);
    },
    traderAssorts: async (traderId, download) => {
        return downloadJson(`${traderId}_assort.json`, `${sptDataPath}traders/${traderId}/assort.json`, download).catch(error => {
            if (!error.message.includes('Response code 404')) {
                return Promise.reject(error);
            }
            return {
                items: [],
                barter_scheme: {},
                loyal_level_items: {},
            };
        });
    },
    traderQuestAssorts: async (traderId, download) => {
        return downloadJson(`${traderId}_questassort.json`, `${sptDataPath}traders/${traderId}/questassort.json`, download).catch(error => {
            if (!error.message.includes('Response code 404')) {
                return Promise.reject(error);
            }
            return {};
        });
    },
};
