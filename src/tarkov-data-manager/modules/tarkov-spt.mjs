import fs from 'node:fs';
import path from 'node:path';

import got from 'got';

import tarkovChanges from './tarkov-changes.mjs';
import discordWebhook from './webhook.mjs';
import dataOptions from './data-options.mjs';

const sptPath = 'https://github.com/sp-tarkov/server/raw/refs/heads/{branch}/project/assets/';
const sptDataPath = `${sptPath}database/`;
const sptConfigPath = `${sptPath}configs/`;

const sptApiPath = 'https://api.github.com/repos/sp-tarkov/server/';

const sptLangs = {
    //'en': 'en',
    'es': 'es',
    'ge': 'de',
    'fr': 'fr',
    'cz': 'cs',
    'hu': 'hu',
    'it': 'it',
    'jp': 'ja',
    'kr': 'ko',
    'pl': 'pl',
    'po': 'pt',
    'ro': 'ro',
    'ru': 'ru',
    'sk': 'sk',
    'tu': 'tr',
    'ch': 'zh',
}

const branches = [
    '3.10.3-DEV',
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
        //return Promise.reject(new Error('SPT_TOKEN not set'));
    }
    const url = `${sptApiPath}branches`;
    const response = await got(url, {
        responseType: 'json',
        resolveBodyOnly: true,
        searchParams: {
            //access_token: process.env.SPT_TOKEN,
        },
    });
    for (const b of branches) {    
        if (response.some(remoteBranch => remoteBranch.name === b)) {
            branch = b;
            return;
        } else {
            await discordWebhook.alert({title: 'SPT repo branch not found', message: b});
        }
    }
    return Promise.reject(new Error('Could not find a valid SPT repo branch'));
};

const downloadJson = async (fileName, path, download = false, writeFile = true, saveElement = false) => {
    if (download) {
        if (!branch) {
            await setBranch();
        }
        const response = await got(path.replace('{branch}', branch), {
            //responseType: 'json',
        });
        if (response.ok) {
            let returnValue = JSON.parse(response.body);
            if (saveElement) {
                returnValue = returnValue[saveElement];
            }
            if (writeFile) {
                fs.writeFileSync(cachePath(fileName), JSON.stringify(returnValue, null, 4));
            }
            return returnValue;
        }
        if (response.statusCode === 404) {
            const oldBranch = branch;
            await setBranch();
            if (oldBranch !== branch) {
                return downloadJson(fileName, path, download, writeFile, saveElement);
            }
        }
        const error = new Error(`Response code ${response.statusCode} (${response.statusMessage})`);
        error.code = response.statusCode;
        return Promise.reject(error);
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
        //return Promise.reject(new Error('SPT_TOKEN not set'));
    }
    if (!branch) {
        await setBranch();
    }
    searchParams = {
        //access_token: process.env.SPT_TOKEN,
        ...searchParams,
        ref: branch,
    };
    const url = `${sptApiPath}${request}`;
    const response = await got(url, {
        //responseType: 'json',
        searchParams: searchParams,
    });
    if (response.ok) {
        return JSON.parse(response.body);
    }
    if (response.statusCode === 404) {
        const oldBranch = branch;
        await setBranch();
        if (oldBranch !== branch) {
            return apiRequest(request, searchParams);
        }
    }
    const error = new Error(`Response code ${response.statusCode} (${response.statusMessage})`);
    error.code = response.statusCode;
    return Promise.reject(error);
};

const getFolderIndex = async (options) => {
    const {
        download,
        folderLabel,
    } = merge(options, {download: true});
    if (!folderLabel) {
        return Promise.reject('getFolderData requires folderLabel in options');
    }
    if (!options.folderPath) {
        return Promise.reject('getFolderData requires folderPath in options');
    }
    if (!download) {
        try {
            return JSON.parse(fs.readFileSync(cachePath(`spt_${folderLabel}_index.json`)));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                return Promise.reject(error);
            }
        }
    }
    let folderIndex = {};
    const folderFiles = await apiRequest(options.folderPath, options.searchParams);
    for (const fileData of folderFiles) {
        if (options.excludeFiles?.some(ex => `${ex}.json` === fileData.name)) {
            continue;
        }
        folderIndex[fileData.name] = fileData;
    }
    fs.writeFileSync(cachePath(`spt_${folderLabel}_index.json`), JSON.stringify(folderIndex, null, 4));
    return folderIndex;
};

const getFolderData = async (options) => {
    const {
        download,
        folderLabel,
    } = merge(options, {download: true});
    if (!folderLabel) {
        return Promise.reject('getFolderData requires folderLabel in options');
    }
    if (!options.folderPath) {
        return Promise.reject('getFolderData requires folderPath in options');
    }
    let oldFolderIndex;
    try {
        oldFolderIndex = JSON.parse(fs.readFileSync(cachePath(`spt_${folderLabel}_index.json`)));
    } catch (error) {
        if (error.code !== 'ENOENT') {
            return Promise.reject(error);
        }
    }
    let folderIndex;
    if (!download && oldFolderIndex) {
        folderIndex = oldFolderIndex;
    } else {
        folderIndex = await getFolderIndex(options);
    }
    const folderData = {};
    for (const filename in folderIndex) {
        const fileIsNew = oldFolderIndex[filename]?.sha !== folderIndex[filename]?.sha || !oldFolderIndex[filename];
        let prefix = '';
        if (options.filePrefix) {
            prefix = `${options.filePrefix}_`;
        }
        if (options.targetFile && options.targetFile !== filename.replace('.json', '')) {
            continue;
        }
        folderData[filename.replace('.json', '')] = downloadJson(`${prefix}${filename}`, folderIndex[filename].download_url, download && fileIsNew);
    }
    for (const fileKey in folderData) {
        folderData[fileKey] = await folderData[fileKey];
    }
    return folderData;
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
        let localeFilename = locale;
        for (const sptLocale in sptLangs) {
            if (sptLangs[sptLocale] === locale) {
                localeFilename = sptLocale;
                break;
            }
        }
        return tarkovSpt.locales({...options, targetFile: localeFilename}).then(locales => locales[locale]);
    },
    locales: async (options = defaultOptions) => {
        const localeData = await getFolderData({
            ...options,
            folderLabel: 'locales',
            folderPath: 'contents/project/assets/database/locales/global',
            filePrefix: 'locale',
        });
        const locales = {};
        for (const sptLocale in localeData) {
            const isoLocale = sptLangs[sptLocale];
            if (!isoLocale) {
                continue;
            }
            locales[isoLocale] = localeData[sptLocale];
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
        const mapLootPromises = [];
        const sptMaps = await apiRequest(`contents/project/assets/database/locations`, options.searchParams);
        for (const id in locations.locations) {
            const map = locations.locations[id];
            if (!sptMaps.some(m => m.name === map.Id.toLowerCase())) {
                continue;
            }
            let locationIndex, oldLocationIndex;
            try {
                oldLocationIndex = JSON.parse(fs.readFileSync(cachePath(`spt_location_${id}_index.json`)));
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    return Promise.reject(error);
                }
            }
            if (!download && oldLocationIndex) {
                locationIndex = oldLocationIndex;
            } else {
                locationIndex = await apiRequest(`contents/project/assets/database/locations/${map.Id.toLowerCase()}`, options.searchParams);
                fs.writeFileSync(cachePath(`spt_location_${id}_index.json`), JSON.stringify(locationIndex, null, 4));
            }
            const looseLootInfo = locationIndex?.find(f => f.name === 'looseLoot.json');
            if (!looseLootInfo) {
                continue;
            }
            const oldLooseLootInfo = oldLocationIndex?.find(f => f.name === 'looseLoot.json');
            const fileIsNew = !oldLooseLootInfo || looseLootInfo?.sha !== oldLooseLootInfo.sha;
            mapLootPromises.push(downloadJson(`${map.Id.toLowerCase()}_loot.json`, `${sptDataPath}locations/${locations.locations[id].Id.toLowerCase()}/looseLoot.json`, download && fileIsNew, true).then(lootJson => {
                mapLoot[id] = lootJson;
            }).catch(error => {
                if (error.code === 'ERR_NON_2XX_3XX_RESPONSE') {
                    mapLoot[id] = [];
                    return;
                }
                return Promise.reject(error);
            }));
        }
        await Promise.all(mapLootPromises);
        return mapLoot;
    },
    botInfo: async (botKey, options = defaultOptions) => {
        botKey = botKey.toLowerCase();
        //return downloadJson(`${botKey}.json`, `${sptDataPath}bots/types/${botKey}.json`, download);
        return await tarkovSpt.botsInfo({...options, targetFile: botKey})[botKey.toLowerCase()];
    },
    botsInfo: async (options = defaultOptions) => {
        return getFolderData({
            ...options,
            folderLabel: 'bots',
            folderPath: 'contents/project/assets/database/bots/types',
        });
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
