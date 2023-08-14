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

const apiRequest = async (request, searchParams) => {
    searchParams = {
        access_token: process.env.SPT_TOKEN,
        ref: 'master',
        ...searchParams
    };
    const url = `https://dev.sp-tarkov.com/api/v1/repos/SPT-AKI/Server/${request}`;
    console.log(url);
    return got(url, {
        responseType: 'json',
        resolveBodyOnly: true,
        searchParams: searchParams,
    });
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
    botInfo: async (botKey, download = true) => {
        botKey = botKey.toLowerCase();
        //return downloadJson(`${botKey}.json`, `${sptDataPath}bots/types/${botKey}.json`, download);
        return await module.exports.botsInfo(download)[botKey.toLowerCase()];
    },
    botsInfo: async (download = true) => {
        const botFiles = await apiRequest('contents/project/assets/database/bots/types');
        const botData = {};
        const exclude = [
            'bear',
            'test',
            'usec',
        ];
        for (fileData of botFiles) {
            if (exclude.some(ex => `${ex}.json` === fileData.name)) {
                continue;
            }
            botData[fileData.name.replace('.json', '')] = downloadJson(fileData.name, fileData.download_url, download);
        }
        for (botKey in botData) {
            botData[botKey] = await botData[botKey];
        }
        return botData;
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
