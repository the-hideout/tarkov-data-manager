import fs from 'node:fs';
import path from 'node:path';

import got from 'got';
import sharp from 'sharp';

import tarkovChanges from './tarkov-data-tarkov-changes.mjs';
import discordWebhook from './webhook.mjs';
import dataOptions from './data-options.mjs';

const sptPath = 'https://github.com/sp-tarkov/server-csharp/raw/refs/heads/{branch}/';
const sptAssetsPathStub = 'Libraries/SPTarkov.Server.Assets/SPT_Data/';
const sptDataPathStub = `${sptAssetsPathStub}database/`;
const sptConfigPathStub = `${sptAssetsPathStub}configs/`;
const sptDataPath = `${sptPath}${sptDataPathStub}`;
const sptConfigPath = `${sptPath}${sptConfigPathStub}`;

const sptApiPath = 'https://api.github.com/repos/sp-tarkov/server-csharp/';

const lfsPath = 'https://spt-lfs.sp-tarkov.com/sp-tarkov/server-csharp/';
const lfsPointerRegEx = /version https:\/\/git-lfs\.github\.com\/spec\/v[0-9]\Woid sha256:(?<oid>[a-z0-9]+)\Wsize (?<size>[0-9]+)/;

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
    '4.1.x-dev',
    'develop',
    'main',
];

let branch, branchSetPromise;

const ghHeaders = process.env.GH_API_TOKEN ? 
    {
        'Authorization': `Bearer ${process.env.GH_API_TOKEN}`,
    } : {};

const defaultOptions = dataOptions.default;
const merge = dataOptions.merge;

const cachePath = (filename) => {
    return path.join(import.meta.dirname, '..', 'cache', filename);   
}

const setBranch = async () => {
    if (branchSetPromise) {
        return branchSetPromise;
    }
    branchSetPromise = new Promise(async (resolve, reject) => {
        try {
            const url = `${sptApiPath}branches`;
            const response = await got(url, {
                responseType: 'json',
                resolveBodyOnly: true,
                headers: ghHeaders,
            });
            for (const b of branches) {    
                if (response.some(remoteBranch => remoteBranch.name === b)) {
                    branch = b;
                    console.log('branch', branch);
                    return resolve();
                } else {
                    await discordWebhook.alert({title: 'SPT repo branch not found', message: b});
                }
            }
            throw new Error('Could not find a valid SPT repo branch');
        } catch (error) {
            reject(error);
        }
    }).finally(() => {
        branchSetPromise = false;
    });
    return branchSetPromise;
};

const downloadJson = async (fileName, path, download = false, writeFile = true, saveElement = false) => {
    if (download) {
        if (!branch) {
            await setBranch();
        }
        const response = await got(path.replace('{branch}', branch), {
            throwHttpErrors: false,
            //responseType: 'json',
        });
        if (response.ok) {
            let responseBody = response.body;
            const lfsMatch = responseBody.match(lfsPointerRegEx);
            if (lfsMatch) {
                responseBody = await lfsDownload(lfsMatch.groups.oid, lfsMatch.groups.size);
            }
            let returnValue = JSON.parse(responseBody);
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
            return downloadJson(fileName, path, true, writeFile, saveElement);
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
    const url = `${sptApiPath}${request}`;
    const response = await got(url, {
        throwHttpErrors: false,
        searchParams: {
            ...searchParams,
            ref: branch,
        },
        headers: ghHeaders,
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
        if (error.code !== 'ENOENT' && 
            !error.message.includes('Unterminated string in JSON') &&
            !error.message.includes('Unexpected end of JSON input')
        ) {
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
        let fileIsNew = false;
        if (oldFolderIndex) {
            fileIsNew = oldFolderIndex[filename]?.sha !== folderIndex[filename]?.sha || !oldFolderIndex[filename];
        }
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

const lfsDownload = async (oid, size) => {
    const lfsInfo = await got(`${lfsPath}objects/batch`, {
        method: 'POST',
        json: {
            operation: 'download',
            objects: [{
                oid,
                size
            }]
        },
    }).json();
    const response = await got(lfsInfo.objects[0].actions.download.href);
    return response.body;
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
    localeOld: async (locale, options = defaultOptions) => {
        let localeFilename = locale;
        for (const sptLocale in sptLangs) {
            if (sptLangs[sptLocale] === locale) {
                localeFilename = sptLocale;
                break;
            }
        }
        return tarkovSpt.localesOld({...options, targetFile: localeFilename}).then(locales => locales[locale]);
    },
    locales: async (options = defaultOptions) => {
        const localeData = await getFolderData({
            ...options,
            folderLabel: 'locales',
            folderPath: `contents/${sptDataPathStub}locales/global`,
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
    localesOld: async (options = defaultOptions) => {
        const localeData = await getFolderData({
            ...options,
            folderLabel: 'locales',
            folderPath: `contents/${sptDataPathStub}locales/global`,
            filePrefix: 'locale_old',
        });
        const locales = {};
        for (const sptLocale in localeData) {
            const isoLocale = sptLocale !== 'en' ? sptLangs[sptLocale] : 'en';
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
        const sptMaps = await apiRequest(`contents/${sptDataPathStub}locations`, options.searchParams);
        for (const id in locations.locations) {
            const map = locations.locations[id];
            if (!sptMaps.some(m => m.name === map.Id.toLowerCase())) {
                continue;
            }
            let locationIndex, oldLocationIndex;
            try {
                oldLocationIndex = JSON.parse(fs.readFileSync(cachePath(`spt_location_${id}_index.json`)));
            } catch (error) {
                if (error.code !== 'ENOENT' && !error.message.includes('Unexpected end of JSON input')) {
                    return Promise.reject(error);
                }
            }
            if (!download && oldLocationIndex) {
                locationIndex = oldLocationIndex;
            } else {
                locationIndex = await apiRequest(`contents/${sptDataPathStub}locations/${map.Id.toLowerCase()}`, options.searchParams);
                fs.writeFileSync(cachePath(`spt_location_${id}_index.json`), JSON.stringify(locationIndex, null, 4));
            }
            const looseLootInfo = locationIndex?.find(f => f.name === 'looseLoot.json');
            if (!looseLootInfo) {
                continue;
            }
            const oldLooseLootInfo = oldLocationIndex?.find(f => f.name === 'looseLoot.json');
            const fileIsNew = !oldLooseLootInfo || looseLootInfo?.sha !== oldLooseLootInfo.sha;
            mapLootPromises.push(downloadJson(`${map.Id.toLowerCase()}_loot.json`, `${sptDataPath}locations/${locations.locations[id].Id.toLowerCase()}/looseLoot.json`, download && fileIsNew).then(lootJson => {
                mapLoot[id] = lootJson;
            }).catch(error => {
                if (error.code === 'ERR_NON_2XX_3XX_RESPONSE') {
                    mapLoot[id] = [];
                    return;
                }
                return Promise.reject(error);
            }));
        }
        const settled = await Promise.allSettled(mapLootPromises);
        const error = settled.find(p => p.status === 'rejected')?.reason;
        if (error) {
            return Promise.reject(error);
        }
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
            folderPath: `contents/${sptDataPathStub}bots/types`,
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
    getImage: async (path) => {
        if (path.startsWith('/files/')) {
            path = path.replace('/files/', '/');
        }
        const fileInfo = await apiRequest(`contents/Libraries/SPTarkov.Server.Assets/SPT_Data/images${path}`).catch(error => {
            if (error.code === 404 || error.code === 403) {
                return null;
            }
            return Promise.reject(error);
        });
        if (!fileInfo?.download_url) {
            return null;
        }
        const response = await fetch(fileInfo.download_url);
        if (!response.ok) {
            return null;
        }
        const image = sharp(await response.arrayBuffer()).webp({lossless: true});
        const metadata = await image.metadata();
        if (metadata.width <= 1 || metadata.height <= 1) {
            return null;
        }
        return image;
    },
};

export default tarkovSpt;
