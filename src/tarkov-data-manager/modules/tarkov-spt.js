const fs = require('fs');
const path = require('path');

const got = require('got');

const sptPath = 'https://dev.sp-tarkov.com/SPT-AKI/Server/raw/branch/development/project/assets/database/';

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
    return downloadJson(`locale_${locale}.json`, `${sptPath}locales/global/${locale}.json`, download);
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
        return downloadJson('handbook.json', `${sptPath}templates/handbook.json`, download);
    },
    locale: getLocale,
    locales: getLocales,
    quests: (download) => {
        return downloadJson('quests.json', `${sptPath}templates/quests.json`, download).then(sptQuests => {
            try {
                let rawFile = false;
                let rawFileDate = new Date(0);
                let backupRaw = false;
                const jsonFiles = fs.readdirSync(path.join(__dirname, '..', 'cache'));
                for (const fileName of jsonFiles) {
                    const match = fileName.match(/\d+resp\.client\.quest\.list_(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})_(?<hour>\d{2})-(?<minute>\d{2})-(?<second>\d{2}).json/);
                    if (match) {
                        const rawDate = new Date(match.groups.year, match.groups.month-1, match.groups.day, match.groups.hour, match.groups.minute, match.groups.second);
                        if (rawDate > rawFileDate) {
                            rawFile = fileName;
                            rawFileDate = rawDate;
                        }
                    } else if (fileName === 'quests_raw.json') {
                        backupRaw = fileName;
                    }
                }
                if (!rawFile && backupRaw) {
                    rawFile = backupRaw;
                }
                if (rawFile) {
                    const rawQuests = JSON.parse(fs.readFileSync(cachePath(rawFile))).data;
                    for (let rawQuest of rawQuests) {
                        const spt = sptQuests[rawQuest._id];
                        if (spt) {
                            rawQuest = {
                                ...rawQuest,
                                conditions: {
                                    ...rawQuest.conditions,
                                    AvailableForStart: spt.conditions.AvailableForStart,
                                }
                            };
                        } 
                        sptQuests[rawQuest._id] = rawQuest;
                        sptQuests[rawQuest._id].raw = true;
                    }
                }
            } catch (error) {
                console.log(error);
            }
            return sptQuests;
        });
    },
    botInfo: (botKey, download = true) => {
        botKey = botKey.toLowerCase();
        return downloadJson(`${botKey}.json`, `${sptPath}bots/types/${botKey}.json`, download);
    },
    traderAssorts: async (traderId, download) => {
        return downloadJson(null, `${sptPath}traders/${traderId}/assort.json`, download).catch(error => {
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
        return downloadJson(null, `${sptPath}traders/${traderId}/questassort.json`, download).catch(error => {
            if (!error.message.includes('Response code 404')) {
                return Promise.reject(error);
            }
            return {};
        });
    },
};
