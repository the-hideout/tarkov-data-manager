import fs from 'node:fs';
import path from 'node:path';

import got from 'got';

import dataOptions from './data-options.mjs';

const defaultOptions = dataOptions.default;
const merge = dataOptions.merge;

const jsonRequest = async (filename, options) => {
    if (!process.env.TC_URL || !process.env.TC_USERNAME || !process.env.TC_PASSWORD) {
        return Promise.reject(new Error('TC_URL, TC_USERNAME, or TC_PASSWORD not set'));
    }
    const { gameMode } = options;
    let path = process.env.TC_URL;
    if (gameMode !== 'regular') {
        path = path.replace('//files', `//${gameMode}-files`);
    }
    const response = await got(path+filename, {
        method: 'POST',
        username: process.env.TC_USERNAME,
        password: process.env.TC_PASSWORD,
        responseType: 'json',
        headers: {
            'Accept': 'application/json',
            'CF-Access-Client-Id': process.env.TC_CF_CLIENT_ID,
            'CF-Access-Client-Secret': process.env.TC_CF_CLIENT_SECRET,
        },
        resolveBodyOnly: true,
        retry: {
            limit: 10,
            calculateDelay: () => {
                return 500;
            }
        },
    });
    if (!response) return Promise.reject(new Error(`Tarkov Changes returned null result for ${path}`));
    return response;
};

const availableFiles = {
    crafts: {},
    credits: {},
    items: {},
    globals: {},
    areas: {},
    traders: {
        requestName: 'traders_clean',
    },
    locations: {},
    locale_en: {
        requestName: 'locale_en_td',
    },
};

const cachePath = (filename) => {
    return path.join(import.meta.dirname, '..', 'cache', filename);   
}

const tarkovChanges = {
    get: async (file, options) => {
        const { download, gameMode } = merge(options);
        const requestFileName = (availableFiles[file].requestName ?? file) + '.json';
        const saveFileName = file + (gameMode === 'regular' ? '' : `_${gameMode}`) + '.json';
        if (download) {
            const returnValue = await jsonRequest(requestFileName, options);
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
    items: async (options = defaultOptions) => {
        return tarkovChanges.get('items', merge(options));
    },
    crafts: async (options = defaultOptions) => {
        return tarkovChanges.get('crafts', merge(options));
    },
    credits: async (options = defaultOptions) => {
        return tarkovChanges.get('credits', merge(options));
    },
    locale_en: async (options = defaultOptions) => {
        return tarkovChanges.get('locale_en', merge(options));
    },
    locations: async (options = defaultOptions) => {
        return tarkovChanges.get('locations', merge(options));
    },
    globals: async(options = defaultOptions) => {
        return tarkovChanges.get('globals', merge(options));
    },
    areas: async(options = defaultOptions) => {
        return tarkovChanges.get('areas', merge(options));
    },
    traders: async (options = defaultOptions) => {
        return tarkovChanges.get('traders', merge(options));
    },
    downloadAll: async (options = defaultOptions) => {
        options = {...merge(options), download: true};
        const skip = {
            pve: [
                'items',
                'credits',
                'locale_en',
            ],
        };
        const promises = [];
        for (const file in availableFiles) {
            if (availableFiles[file].skip) continue;
            if (skip[options.gameMode]?.includes(file)) continue;
            promises.push(tarkovChanges[file](options).then(data => {return {name: file, data: data}}));
        }
        //promises.push(getSptLocales(true).then(data => {return {name: 'locales', data: data}}));
        const results = await Promise.allSettled(promises);
        const errors = [];
        const values = {};
        for (let i = 0; i < results.length; i++) {
            if (results[i].status === 'fulfilled') {
                values[results[i].value.name] = results[i].value.data;
            } else {
                errors.push(results[i].reason.message);
            }
        }
        if (options.returnPartial && Object.values(values).length > 0) {
            values.errors = errors;
            return values;
        }
        if (errors.length > 0) {
            return Promise.reject(new Error(errors.join('; ')));
        }
        return values;
    }
}

export default tarkovChanges;
