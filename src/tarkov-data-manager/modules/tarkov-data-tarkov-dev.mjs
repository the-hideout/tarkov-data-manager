import fs from 'node:fs';
import path from 'node:path';

import got from 'got';
import sharp from 'sharp';

import dataOptions from './data-options.mjs';

const availableFiles = {
    'achievements': {},
    'achievementStats': {
        requestName: 'achievements_stats',
    },
    'areas': {},
    'crafts': {},
    'credits': {},
    'customization': {},
    'items': {},
    'globals': {},
    'locale_en': {},
    'locations': {},
    'prestige': {},
    'traders': {},
    'handbook': {},
    //'status',
};

const arrayToDictionary = [
    'areas',
    'crafts',
    'traders',
];

const failedHosts = [];

const defaultOptions = dataOptions.default;
const merge = dataOptions.merge;

const cachePath = (filename) => {
    return path.join(import.meta.dirname, '..', 'cache', filename);   
}

const getFromFence = async (jsonName, options) => {
    if (!process.env.FENCE_BASIC_AUTH) {
        return Promise.reject(new Error('FENCE_BASIC_AUTH not set'));
    }
    let jsonRequest = jsonName;
    if (availableFiles[jsonName]?.requestName) {
        jsonRequest = availableFiles[jsonName].requestName;
    }
    const requestURL = new URL(`https://fence.tarkov.dev/json/${jsonRequest}`);
    requestURL.searchParams.set('m', options.gameMode ?? 'regular');
    const response = await got(requestURL, {
        method: options.method ?? 'GET',
        headers: {
            'Authorization': `Basic ${process.env.FENCE_BASIC_AUTH}`,
        },
        retry: {
            limit: 10,
            calculateDelay: (retryInfo) => {
                //console.log(jsonName, retryInfo);
                if (retryInfo.attemptCount > retryInfo.retryOptions.limit) {
                    return 0;
                }
                return 1000;
            }
        },
        timeout: {
            request: 60000,
        },
        signal: options.signal,
    });
    if (!response.ok) {
        return Promise.reject(new Error(`${response.statusCode} ${response.statusMessage}`));
    }
    return JSON.parse(response.body);
};

const tarkovDevData = {
    fenceFetch: (path, options = {}) => {
        if (!options) {
            options = {};
        }
        if (!options.headers) {
            options.headers = {};
        }
        options.headers.Authorization = `Basic ${process.env.FENCE_BASIC_AUTH}`;
        const url = new URL('https://fence.tarkov.dev');
        url.pathname = path;
        return fetch(url, options);
    },
    fenceFetchImage: async (path, options = {}) => {
        const response = await tarkovDevData.fenceFetch(path, options);
        if (!response.ok) {
            return Promise.reject(new Error(`${response.status} ${response.statusText}`));
        }
        if (!response.headers.get('content-type')?.includes('image/')) {
            return Promise.reject(new Error(`Content type ${response.headers.get('content-type')} is not an image`));
        }
        return sharp(await response.arrayBuffer());
    },
    fencePassthrough: async (url, options = {}) => {
        const hostName = new URL(url).hostname;
        if (!failedHosts.includes(hostName)) {
            const response = await fetch(url, options);
            if (response.ok) {
                return response;
            }
            failedHosts.push(hostName);
        }
        return tarkovDevData.fenceFetch('/passthrough-request', {
            ...options,
            method: 'POST',
            body: JSON.stringify({
                url,
            }),
        });
    },
    get: async (jsonName, options = defaultOptions) => {
        const { download, gameMode } = merge(options);
        const suffix = gameMode === 'regular' ? '' : `_${gameMode}`;
        const filename = `${jsonName}${suffix}.json`;
        if (!download) {
            try {
                return JSON.parse(fs.readFileSync(cachePath(filename)));
            } catch (error) {
                if (error.code !== 'ENOENT' && 
                    !error.message.includes('Unexpected end of JSON input')
                ) {
                    return Promise.reject(error);
                }
            }
        }
        /*let newJson = await webSocketServer.getJson(jsonName, gameMode);
        if (newJson.elements) {
            newJson = newJson.elements;
        }
        if (Array.isArray(newJson) && arrayToDictionary.includes(jsonName)) {
            newJson = newJson.reduce((all, current) => {
                all[current.id ?? current._id] = current;
                return all;
            }, {});
        }*/
        const newJson = await getFromFence(jsonName, options);
        fs.writeFileSync(cachePath(filename), JSON.stringify(newJson, null, 4));
        return newJson;
    },
    achievements: async (options = defaultOptions) => {
        return tarkovDevData.get('achievements', options);
    },
    achievementStats: async (options = defaultOptions) => {
        return tarkovDevData.get('achievement_stats', options);
    },
    items: async (options = defaultOptions) => {
        return tarkovDevData.get('items', options);
    },
    crafts: async (options = defaultOptions) => {
        return tarkovDevData.get('crafts', options);
    },
    credits: async (options = defaultOptions) => {
        return tarkovDevData.get('credits', options);
    },
    customization: async (options = defaultOptions) => {
        return tarkovDevData.get('customization', options);
    },
    locale_en: async (options = defaultOptions) => {
        return tarkovDevData.get('locale_en', options);
    },
    locations: async (options = defaultOptions) => {
        return tarkovDevData.get('locations', options);
    },
    globals: async(options = defaultOptions) => {
        return tarkovDevData.get('globals', options);
    },
    areas: async(options = defaultOptions) => {
        return tarkovDevData.get('areas', options);
    },
    traders: async (options = defaultOptions) => {
        return tarkovDevData.get('traders', options);
    },
    handbook: async (options = defaultOptions) => {
        return tarkovDevData.get('handbook', options);
    },
    prestige: async (options = defaultOptions) => {
        return tarkovDevData.get('prestige', options);
    },
    status: async (options = defaultOptions) => {
        return tarkovDevData.get('status', options);
    },
    downloadAll: async(options = defaultOptions) => {
        options = {...merge(options), download: true};
        const gameMode = getGameMode(options.gameMode);
        const promises = [];
        for (const file in availableFiles) {
            if (gameMode.skipData?.includes(file)) continue;
            promises.push(tarkovDevData[file](options)
                .then(data => { return {name: file, data}; })
                .catch(error => { return {name: file, error}; })
            );
        }
        const results = await Promise.all(promises);
        const errors = {};
        const values = {};
        for (let i = 0; i < results.length; i++) {
            if (results[i].data) {
                values[results[i].name] = results[i].data;
            } else {
                errors[results[i].name] = results[i].error;
            }
        }
        if (options.returnErrors && Object.values(errors).length > 0) {
            values.errors = errors;
            return values;
        }
        if (errors.length > 0) {
            return Promise.reject(new Error(Object.keys(errors).map(file => `${file}: ${errors[file].message}`).join('; ')));
        }
        return values;
    },
}

export default tarkovDevData;
