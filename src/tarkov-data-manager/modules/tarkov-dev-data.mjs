import fs from 'node:fs';
import path from 'node:path';

import webSocketServer from './websocket-server.mjs';
import dataOptions from './data-options.mjs';

const availableFiles = [
    'achievements',
    'achievement_stats',
    'areas',
    'crafts',
    'credits',
    'items',
    'globals',
    'locale_en',
    'locations',
    'traders',
    //'status',
];

const arrayToDictionary = [
    'areas',
    'crafts',
    'traders',
];

const defaultOptions = dataOptions.default;
const merge = dataOptions.merge;

const cachePath = (filename) => {
    return path.join(import.meta.dirname, '..', 'cache', filename);   
}

const tarkovDevData = {
    get: async (jsonName, options = defaultOptions) => {
        const { download, gameMode } = merge(options);
        const suffix = gameMode === 'regular' ? '' : `_${gameMode}`;
        const filename = `${jsonName}${suffix}.json`;
        if (!download) {
            try {
                return JSON.parse(fs.readFileSync(cachePath(filename)));
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    return Promise.reject(error);
                }
            }
        }
        let newJson = await webSocketServer.getJson(jsonName, gameMode);
        if (newJson.elements) {
            newJson = newJson.elements;
        }
        if (Array.isArray(newJson) && arrayToDictionary.includes(jsonName)) {
            newJson = newJson.reduce((all, current) => {
                all[current.id ?? current._id] = current;
                return all;
            }, {});
        }
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
    status: async (options = defaultOptions) => {
        return tarkovDevData.get('status', options);
    },
    downloadAll: async(options = defaultOptions) => {
        options = {...merge(options), download: true};
        const skip = {
            pve: [
                'achievements',
                'achievementStats',
                'locale_en',
            ],
        };
        const promises = [];
        for (const file in availableFiles) {
            if (skip[options.gameMode]?.includes(file)) continue;
            promises.push(tarkovDevData[file](options).then(data => {return {name: file, data: data}}));
        }
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
    },
}

export default tarkovDevData;
