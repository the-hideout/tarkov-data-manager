const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const tarkovChanges = require('./tarkov-changes');
const scannerApi = require('./scanner-api');

const emitter = new EventEmitter();

const updateJson = async (jsonName) => {
    scannerApi.addCommand('json', jsonName);
};

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

/*if (process.env.SKIP_JOBS !== 'true') {
    setInterval(() => {
        let filesRemaining = [...availableFiles];
        const updateListener = (jsonData) => {
            filesRemaining = filesRemaining.filter(jsonName => jsonData.name !== jsonName);
            if (filesRemaining.length > 0) {
                return;
            }
            emitter.emit('refreshed');
            scannerApi.off(updateListener);
        };
        scannerApi.on('jsonUpdate', updateListener);
        //updateJson(['areas', 'crafts', 'items']);
        //updateJson(['globals', 'locations', 'status']);
        //updateJson(['credits', 'locale_en']);
    }, 1000 * 60 * 10);
}*/

const cachePath = (filename) => {
    return path.join(__dirname, '..', 'cache', filename);   
}

module.exports = {
    get: async (jsonName) => {
        try {
            return JSON.parse(fs.readFileSync(cachePath(`${jsonName}.json`)));
        } catch (error) {
            if (error.code === 'ENOENT') {
                return tarkovChanges[jsonName](true);
            }
            return Promise.reject(error);
        }
    },
    items: async () => {
        return module.exports.get('items');
    },
    crafts: async () => {
        return module.exports.get('crafts');
    },
    credits: async () => {
        return module.exports.get('credits');
    },
    locale_en: async () => {
        return module.exports.get('locale_en');
    },
    locations: async () => {
        return module.exports.get('locations');
    },
    globals: async() => {
        return module.exports.get('globals');
    },
    areas: async() => {
        return module.exports.get('areas');
    },
    traders: async () => {
        return module.exports.get('trader');
    },
    status: async () => {
        try {
            return JSON.parse(fs.readFileSync(cachePath(`${jsonName}.json`)));
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    services: [],
                    messages: [],
                    global: {
                        status: 0,
                        message: ''
                    },
                };
            }
            return Promise.reject(error);
        }
    },
}
