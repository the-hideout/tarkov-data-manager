import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import dataOptions from './data-options.mjs';
import sleep from './sleep.js';
import ApiClient from './api-client.mjs';

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

const fenceClient = new ApiClient({
    cacheFolder: 'fence',
    urlBase: 'https://fence.tarkov.dev',
    headers: {
        'Authorization': `Basic ${process.env.FENCE_BASIC_AUTH}`,
    },
});

const tarkovDevData = {
    fenceFetch: (path, options = {}) => {
        options ??= {};
        options.headers ??= {};
        options.headers.Authorization = `Basic ${process.env.FENCE_BASIC_AUTH}`;
        const url = new URL('https://fence.tarkov.dev');
        url.pathname = path;
        if (options.searchParams) {
            for (const paramName in options.searchParams) {
                url.searchParams.set(paramName, options.searchParams[paramName]);
            }
        }
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
        const cachedName = `${jsonName}_${gameMode}.json`;
        let jsonRequest = jsonName;
        if (availableFiles[jsonName]?.requestName) {
            jsonRequest = availableFiles[jsonName].requestName;
        }
        return fenceClient.get({
            cachedName,
            pathname: `/json/${jsonName}`,
            refresh: options.download,
        });
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
    quests: async (options = defaultOptions) => {
        return tarkovDevData.get('quests', options);
    },
    status: async (options = defaultOptions) => {
        return tarkovDevData.get('status', options);
    },
    mapData: async (map, options = defaultOptions) => {
        return tarkovDevData.get(`map-data_${map}`, options);
    },
    mapDataLegacy: async (map, options = defaultOptions) => {
        return tarkovDevData.get(`map-data-legacy_${map}`, options);
    },
    scannersStatus: async () => {
        const response = await tarkovDevData.fenceFetch('/status');
        if (!response.ok) {
            return Promise.reject(new Error(`${response.status} ${response.statusText}`));
        }
        return response.json();
    },
    scannerStart: async (scannerDomain) => {
        const response = await tarkovDevData.fenceFetch('/command/start', {
            searchParams: {
                scanner: scannerDomain,
            },
        });
        if (!response.ok) {
            return Promise.reject(new Error(`${response.status} ${response.statusText}`));
        }
        return response.text();
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
