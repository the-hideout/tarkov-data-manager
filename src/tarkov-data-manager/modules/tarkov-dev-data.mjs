import fs from 'node:fs';
import path from 'node:path';

import webSocketServer from './websocket-server.mjs';
import dataOptions from './data-options.mjs';

const availableFiles = [
    'achievements',
    'achievement_stats',
    /*'areas',
    'crafts',
    'credits',
    'items',
    'globals',
    'locale_en',
    'locations',*/
    'traders',
    //'status',
];

const arrayToDictionary = [
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
        const results = {
            errors: {},
        };
        const promises = [];
        for (const jsonName of availableFiles) {
            promises.push(tarkovDevData.get(jsonName, {...merge(options), download: true}).then(data => {
                results[jsonName] = data;
                return data;
            }).catch(error => {
                results.errors[jsonName] = error;
            }));
        }
        await Promise.allSettled(promises);
        return results;
    },
}

export default tarkovDevData;
