import fs from 'node:fs';
import path from 'node:path';

import got from 'got';

import dataOptions from './data-options.mjs';

const defaultOptions = dataOptions.default;
const merge = dataOptions.merge;

const jsonRequest = async (filename, options) => {
    if (!process.env.TC_URL || !process.env.TC_LATEST_URL || !process.env.TC_API_KEY) {
        return Promise.reject(new Error('TC_LATEST_URL or TC_API_KEY not set'));
    }
    const { gameMode } = options;
    let path = process.env.TC_LATEST_URL;
    if (gameMode !== 'regular') {
        // path += '/pve'; // enable this when pve data is available
    }
    path += '/latest/';
    const response = await got(path+filename, {
        method: 'GET',
        responseType: 'json',
        headers: {
            'Accept': 'application/json',
            'X-API-KEY': process.env.TC_API_KEY,
        },
        resolveBodyOnly: true,
        retry: {
            limit: 10,
            calculateDelay: (retryInfo) => {
                if (retryInfo.attemptCount > retryInfo.retryOptions.limit) {
                    return 0;
                }
                return 1000;
            }
        },
        timeout: {
            request: 10000,
        },
        signal: options.signal,
    }).then(apiResponse => {
        if (apiResponse.status && apiResponse.status !== 'success') {
            return Promise.reject(new Error('API response does not indicate success', {cause: apiResponse}));
        }
        return apiResponse.response_data;
    });
    if (!response) return Promise.reject(new Error(`Tarkov Changes returned null result for ${path}`));
    return response;
};

const availableFiles = {
    achievements: {
        requestName: 'achievement_list',
    },
    achievementStats: {
        requestName: 'achievement_statistic',
    },
    areas: {
        requestName: 'hideout_areas',
    },
    crafts: {
        requestName: 'hideout_recipes',
    },
    credits: {
        requestName: 'items_prices',
    },
    customization: {},
    globals: {},
    items: {},
    handbook: {
        requestName: 'handbook_templates',
    },
    locale_en: {},
    locations: {},
    prestige: {
        requestName: 'prestige_list',
    },
    traders: {},
};

const cachePath = (filename) => {
    return path.join(import.meta.dirname, '..', 'cache', filename);   
}

const convertToArray = [
    'areas',
];

const tarkovChanges = {
    get: async (file, options) => {
        const { download, gameMode } = merge(options);
        const requestFileName = (availableFiles[file]?.requestName ?? file);
        const saveFileName = file + (gameMode === 'regular' ? '' : `_${gameMode}`) + '.json';
        if (download) {
            let returnValue = await jsonRequest(requestFileName, options);
            if (returnValue.elements) {
                returnValue = returnValue.elements;
            }
            if (convertToArray.includes(file) && !Array.isArray(returnValue)) {
                returnValue = Object.values(returnValue);
            }
            fs.writeFileSync(cachePath(saveFileName), JSON.stringify(returnValue, null, 4));
            return returnValue;
        }
        try {
            return JSON.parse(fs.readFileSync(cachePath(saveFileName)));
        } catch (error) {
            if (error.code === 'ENOENT') {
                return tarkovChanges.get(file, {...options, download: true});
            }
            return Promise.reject(error);
        }
    },
    achievements: (options = defaultOptions) => {
        return tarkovChanges.get('achievements', merge(options));
    },
    achievementStats: (options = defaultOptions) => {
        return tarkovChanges.get('achievementStats', merge(options));
    },
    areas: async(options = defaultOptions) => {
        return tarkovChanges.get('areas', merge(options));
    },
    crafts: async (options = defaultOptions) => {
        return tarkovChanges.get('crafts', merge(options));
    },
    credits: async (options = defaultOptions) => {
        return tarkovChanges.get('credits', merge(options));
    },
    customization: async (options = defaultOptions) => {
        return tarkovChanges.get('customization', merge(options));
    },
    globals: async(options = defaultOptions) => {
        return tarkovChanges.get('globals', merge(options));
    },
    handbook: async(options = defaultOptions) => {
        return tarkovChanges.get('handbook', merge(options));
    },
    items: async (options = defaultOptions) => {
        return tarkovChanges.get('items', merge(options));
    },
    locale_en: async (options = defaultOptions) => {
        return tarkovChanges.get('locale_en', merge(options));
    },
    locations: async (options = defaultOptions) => {
        return tarkovChanges.get('locations', merge(options));
    },
    prestige: async (options = defaultOptions) => {
        return tarkovChanges.get('prestige', merge(options));
    },
    traders: async (options = defaultOptions) => {
        return tarkovChanges.get('traders', merge(options));
    },
    downloadAll: async (options = defaultOptions) => {
        options = {...merge(options), download: true};
        const skip = {
            pve: [
                'achievements',
                'achievementStats',
                'items',
                'locale_en',
            ],
        };
        const promises = [];
        for (const file in availableFiles) {
            if (availableFiles[file].skip) continue;
            if (skip[options.gameMode]?.includes(file)) continue;
            promises.push(tarkovChanges[file](options)
                .then(data => {return {name: file, data}})
                .catch(error => {return {name: file, error}})
            );
        }
        //promises.push(getSptLocales(true).then(data => {return {name: 'locales', data: data}}));
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
    restart: async (options = defaultOptions) => {
        if (!process.env.TC_RESTART_URL) {
            return Promise.reject(new Error('Credentials not set'));
        }
        const response = await got(process.env.TC_RESTART_URL, {
            method: 'GET',
            headers: {
                'CF-Access-Client-Id': process.env.TC_RESTART_CLIENT_ID,
                'CF-Access-Client-Secret': process.env.TC_RESTART_CLIENT_SECRET,
            },
            signal: options.signal,
        });
        if (!response.ok) {
            return Promise.reject(new Error(`${response.statusCode} ${response.statusMessage}`));
        }
        if (response.body.includes('Sign in')) {
            return Promise.reject(new Error('Login required'));
        }
        return response.body;
    }
}

export default tarkovChanges;
