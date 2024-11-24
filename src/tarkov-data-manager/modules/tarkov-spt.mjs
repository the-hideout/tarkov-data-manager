import fs from 'node:fs';
import path from 'node:path';

import got from 'got';

import tarkovChanges from './tarkov-changes.mjs';
import discordWebhook from './webhook.mjs';
import dataOptions from './data-options.mjs';

const sptPath = 'https://github.com/sp-tarkov/server/raw/refs/heads/{branch}/project/assets/';
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
    'ro': 'ro',
    'ru': 'ru',
    'sk': 'sk',
    'tr': 'tu',
    'zh': 'ch',
}

const branches = [
    '3.10.0-DEV',
    'master',
];

let branch;

const defaultOptions = dataOptions.default;
const merge = dataOptions.merge;

const cachePath = (filename) => {
    return path.join(import.meta.dirname, '..', 'cache', filename);   
}

const setBranch = async () => {
    if (!process.env.SPT_TOKEN) {
        return Promise.reject(new Error('SPT_TOKEN not set'));
    }
    const url = `https://dev.sp-tarkov.com/api/v1/repos/SPT-AKI/Server/branches`;
    const response = await got(url, {
        responseType: 'json',
        resolveBodyOnly: true,
        searchParams: {
            access_token: process.env.SPT_TOKEN,
        },
    });
    for (const b of branches) {    
        if (response.some(remoteBranch => remoteBranch.name === b)) {
            branch = b;
            break;
        } else {
            await discordWebhook({title: 'SPT repo branch not found', message: b});
        }
    }
};

const downloadJson = async (fileName, path, download = false, writeFile = true, saveElement = false) => {
    if (download) {
        if (!branch) {
            await setBranch();
        }
        path = path.replace('{branch}', branch);
        let returnValue = await got(path, {
            responseType: 'json',
            resolveBodyOnly: true,
        });
        if (saveElement) {
            returnValue = returnValue[saveElement];
        }
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
    if (!process.env.SPT_TOKEN) {
        return Promise.reject(new Error('SPT_TOKEN not set'));
    }
    if (!branch) {
        await setBranch();
    }
    searchParams = {
        //access_token: process.env.SPT_TOKEN,
        ref: branch,
        ...searchParams
    };
    const url = `https://api.github.com/repos/sp-tarkov/server/${request}`;
    return got(url, {
        responseType: 'json',
        resolveBodyOnly: true,
        searchParams: searchParams,
    });
};

const tarkovSpt = {
    achievements: (options = defaultOptions) => {
        const { download } = merge(options);
        return downloadJson('achievements.json', `${sptDataPath}templates/achievements.json`, download);
    },
    handbook: (options = defaultOptions) => {
        const { download } = merge(options);
        return downloadJson('handbook.json', `${sptDataPath}templates/handbook.json`, download);
    },
    locale: async (locale, options = defaultOptions) => {
        const { download } = merge(options);
        if (sptLangs[locale]) {
            locale = sptLangs[locale];
        }
        return downloadJson(`locale_${locale}.json`, `${sptDataPath}locales/global/${locale}.json`, download);
    },
    locales: async (options = defaultOptions) => {
        const langCodes = Object.keys(sptLangs);
        const localePromises = [];
        for (const locale of langCodes) {
            localePromises.push(tarkovSpt.locale(locale, options).then(localeData => {
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
    },
    quests: (options = defaultOptions) => {
        const { download } = merge(options);
        return downloadJson('quests.json', `${sptDataPath}templates/quests.json`, download);
    },
    questConfig: (options = defaultOptions) => {
        const { download } = merge(options);
        return downloadJson('questConfig.json', `${sptConfigPath}quest.json`, download);
    },
    mapLoot: async (options = defaultOptions) => {
        const { download } = merge(options);
        const mapLoot = {};
        const locations = await tarkovChanges.locations();
        for (const id in locations.locations) {
            const map = locations.locations[id];
            try {
                mapLoot[id] = await downloadJson(`${map.Id.toLowerCase()}_loot.json`, `${sptDataPath}locations/${locations.locations[id].Id.toLowerCase()}/looseLoot.json`, download, true);
            } catch (error) {
                if (error.code === 'ERR_NON_2XX_3XX_RESPONSE') {
                    mapLoot[id] = [];
                    continue;
                }
                return Promise.reject(error);
            }
        }
        return mapLoot;
    },
    botInfo: async (botKey, options = defaultOptions) => {
        const { download } = merge(options, {download: true});
        botKey = botKey.toLowerCase();
        //return downloadJson(`${botKey}.json`, `${sptDataPath}bots/types/${botKey}.json`, download);
        return await tarkovSpt.botsInfo(download)[botKey.toLowerCase()];
    },
    botsInfo: async (options = defaultOptions) => {
        const { download } = merge(options, {download: true});
        let botIndex = {};
        const botData = {};
        if (!fs.existsSync(cachePath('bots_index.json')) || download) {
            const botFiles = await apiRequest('contents/project/assets/database/bots/types');
            const exclude = [
                'bear',
                'test',
                'usec',
            ];
            for (const fileData of botFiles) {
                if (exclude.some(ex => `${ex}.json` === fileData.name)) {
                    continue;
                }
                botIndex[fileData.name] = fileData.download_url;
            }
            fs.writeFileSync(cachePath('bots_index.json'), JSON.stringify(botIndex, null, 4));
        } else {
            botIndex = JSON.parse(fs.readFileSync(cachePath('bots_index.json')));
        }
        for (const filename in botIndex) {
            botData[filename.replace('.json', '')] = downloadJson(filename, botIndex[filename], download);
        }
        for (const botKey in botData) {
            botData[botKey] = await botData[botKey];
        }
        return botData;
    },
    traderAssorts: async (traderId, options = defaultOptions) => {
        const { download } = merge(options);
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
    traderQuestAssorts: async (traderId, options = defaultOptions) => {
        const { download } = merge(options);
        return downloadJson(`${traderId}_questassort.json`, `${sptDataPath}traders/${traderId}/questassort.json`, download).catch(error => {
            if (!error.message.includes('Response code 404')) {
                return Promise.reject(error);
            }
            return {};
        });
    },
};

export default tarkovSpt;
