import fs from 'node:fs';
import path from 'node:path';

import webSocketServer from './websocket-server.mjs';

const availableFiles = [
    'achievements',
    'achievement_stats',
    /*'areas',
    'crafts',
    'credits',
    'items',
    'globals',
    'locale_en',
    'locations',
    'traders',*/
    //'status',
];

const cachePath = (filename) => {
    return path.join(import.meta.dirname, '..', 'cache', filename);   
}

const tarkovDevData = {
    get: async (jsonName, refresh = false, sessionMode = 'regular') => {
        const sessionModeQualifier = sessionMode === 'regular' ? '' : `_${sessionMode}`;
        const filename = `${jsonName}${sessionModeQualifier}.json`;
        if (!refresh) {
            try {
                return JSON.parse(fs.readFileSync(cachePath(filename)));
            } catch (error) {
                return Promise.reject(error);
            }
        }
        let newJson = await webSocketServer.getJson(jsonName, sessionMode);
        if (newJson.elements) {
            newJson = newJson.elements;
        }
        fs.writeFileSync(cachePath(filename), JSON.stringify(newJson, null, 4));
        return newJson;
    },
    achievements: async (refresh = false, sessionMode = 'regular') => {
        return tarkovDevData.get('achievements', refresh, sessionMode);
    },
    achievementStats: async (refresh = false, sessionMode = 'regular') => {
        return tarkovDevData.get('achievement_stats', refresh, sessionMode);
    },
    items: async (refresh = false, sessionMode = 'regular') => {
        return tarkovDevData.get('items', refresh, sessionMode);
    },
    crafts: async (refresh = false, sessionMode = 'regular') => {
        return tarkovDevData.get('crafts', refresh, sessionMode);
    },
    credits: async (refresh = false, sessionMode = 'regular') => {
        return tarkovDevData.get('credits', refresh, sessionMode);
    },
    locale_en: async (refresh = false, sessionMode = 'regular') => {
        return tarkovDevData.get('locale_en', refresh, sessionMode);
    },
    locations: async (refresh = false, sessionMode = 'regular') => {
        return tarkovDevData.get('locations', refresh, sessionMode);
    },
    globals: async(refresh = false, sessionMode = 'regular') => {
        return tarkovDevData.get('globals', refresh, sessionMode);
    },
    areas: async(refresh = false, sessionMode = 'regular') => {
        return tarkovDevData.get('areas', refresh, sessionMode);
    },
    traders: async (refresh = false, sessionMode = 'regular') => {
        return tarkovDevData.get('trader', refresh, sessionMode);
    },
    status: async (refresh = false) => {
        return tarkovDevData.get('status', refresh);
    },
    downloadAll: async(sessionMode = 'regular') => {
        const results = {
            errors: {},
        };
        const promises = [];
        for (const jsonName of availableFiles) {
            promises.push(tarkovDevData.get(jsonName, true, sessionMode).then(data => {
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
