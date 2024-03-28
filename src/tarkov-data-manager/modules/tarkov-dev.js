const fs = require('fs');
const path = require('path');

const webSocketServer = require('./websocket-server');

const availableFiles = [
    'areas',
    'crafts',
    'credits',
    'items',
    'globals',
    'locale_en',
    'locations',
    'traders',
    'status',
];

const cachePath = (filename) => {
    return path.join(__dirname, '..', 'cache', filename);   
}

const tarkovDevData = {
    get: async (jsonName, refresh = false) => {
        const filename = `${jsonName}.json`;
        if (!refresh) {
            try {
                return JSON.parse(fs.readFileSync(cachePath(filename)));
            } catch (error) {
                return Promise.reject(error);
            }
        }
        const newJson = await webSocketServer.getJson(jsonName);
        if (newJson.error) {
            return Promise.reject(new Error(newJson.error));
        }
        fs.writeFileSync(cachePath(filename), JSON.stringify(newJson, null, 4));
        return newJson;
    },
    items: async (refresh = false) => {
        return tarkovDevData.get('items', refresh);
    },
    crafts: async (refresh = false) => {
        return tarkovDevData.get('crafts', refresh);
    },
    credits: async (refresh = false) => {
        return tarkovDevData.get('credits', refresh);
    },
    locale_en: async (refresh = false) => {
        return tarkovDevData.get('locale_en', refresh);
    },
    locations: async (refresh = false) => {
        return tarkovDevData.get('locations', refresh);
    },
    globals: async(refresh = false) => {
        return tarkovDevData.get('globals', refresh);
    },
    areas: async(refresh = false) => {
        return tarkovDevData.get('areas', refresh);
    },
    traders: async (refresh = false) => {
        return tarkovDevData.get('trader', refresh);
    },
    status: async (refresh = false) => {
        return tarkovDevData.get('status', refresh);
    },
}

module.exports = tarkovDevData;
