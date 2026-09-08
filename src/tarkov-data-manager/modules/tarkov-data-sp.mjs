import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import Bottleneck from 'bottleneck';

import gameModes from './game-modes.mjs';
import dataOptions from './data-options.mjs';

const defaultOptions = dataOptions.default;
const merge = dataOptions.merge;

const cachePath = (filename) => {
    const pathParts = [
        import.meta.dirname,
        '..',
        'cache',
        'sp',
    ];
    if (filename) {
        pathParts.push(filename);
    }
    return path.join(...pathParts);   
}

const ensureCachePath = () => {
    const path = cachePath();
    if (fs.existsSync(path)) {
        return;
    }
    fs.mkdirSync(path, { recursive: true });
};

const writeToCache = (filename, content) => {
    ensureCachePath();
    fs.writeFileSync(cachePath(filename), content);
};

const ApiRequest = async (url, options = {}) => {
    if (!url) {
        throw new Error('No url specified');
    }
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.stringify(options.body) : undefined;
    const headers = options.headers;
    if (options.params) {
        for (const paramName in options.params) {
            url.searchParams.set(paramName, options.params[paramName]);
        }
    }
    const response = await fetch(url, {
        method,
        body,
        headers,
        signal: options.signal ?? AbortSignal.timeout(30000),
    });
    if (!response.ok) {
        return Promise.reject(new Error(`${response.status} ${response.statusText}`));
    }
    return response.json();
};

const getGameType = (gameMode) => {
    if (gameMode === 'regular') {
        return 'eft';
    }
    if (gameMode === 'pvp-season') {
        return 'season';
    }
    return gameMode;
}

const endpointList = {
    achievements: {
        path: 'client/achievement/list/response.json',
    },
    achievementStats: {
        path: 'client/achievement/statistic/response.json',
    },
    areas: {
        path: 'client/hideout/areas/response.json',
    },
    crafts: {
        path: 'client/hideout/production/recipes/response.json',
    },
    credits: {
        path: 'client/items/prices/response.json',
    },
    customization: {
        path: 'client/customization/response.json',
    },
    globals: {
        path: 'client/globals/response.json',
    },
    handbook: {
        path: 'client/handbook/templates/response.json',
    },
    items: {
        path: 'client/items/response.json',
    },
    locale_en: {
        path: 'client/locale/en/response.json',
    },
    locations: {
        path: 'client/locations/response.json',
    },
    prestige: {
        path: 'client/prestige/list/response.json',
    },
    seasonalPerks: {
        path: 'client/seasonal-perks/list/response.json',
    },
    traders: {
        path: 'client/trading/api/traderSettings/response.json',
    },
    storyChapters: {
        path: 'client/quest/getMainQuestsList/response.json',
    },
    tapeList: {
        path: 'client/tape/list/response.json',
    },
};

const FleaApiRequest = (path, options = {}) => {
    const gameType = getGameType(options.gameMode ?? 'regular');
    const url = new URL(`https://publicfleaapi.asoloproject.xyz/api/v2/flea-advanced/${gameType}${path}`);
    return ApiRequest(url, options);
};

const BotApiRequest = (path, options) => {
    const url = new URL(`https://tarkovbotroleapi.asoloproject.xyz/api${path}`);
    return ApiRequest(url, options);
};

const limiter = new Bottleneck({
    reservoir: 30, // initial value
    reservoirRefreshAmount: 30,
    reservoirRefreshInterval: 10 * 1000, // must be divisible by 250
    maxConcurrent: 30,
    //minTime: 333 // pick a value that makes sense for your use case
});

const DumpsApiRequest = async (jsonName, options = {}) => {
    const filePath = endpointList[jsonName]?.path;
    if (!filePath) {
        throw new Error(`${jsonName} is an unknown json request`);
    }
    const gameType = getGameType(options.gameMode ?? 'regular');
    const url = new URL(`${process.env.SP_DUMPS_URL}/${gameType}/latest/file`);
    url.searchParams.set('filename', filePath);
    options.headers = {
        'CF-Access-Client-Id': process.env.SP_CF_ACCESS_CLIENT_ID,
        'CF-Access-Client-Secret': process.env.SP_CF_ACCESS_CLIENT_SECRET,
        'x-api-key': process.env.SP_X_API_KEY,
    };
    const json = await ApiRequest(url, options);
    if (json.err) {
        throw new Error(`${json.err} ${json.errmsg}`);
    }
    return json.data.elements ?? json.data;
};

const spApi = {
    fleaPrices: async (gameMode = 'regular') => {
        const apiResponse = await FleaApiRequest(`/items-overview`, {gameMode});
        if (!apiResponse.items) {
            return Promise.reject(new Error('Response missing items attribute'));
        }
        return apiResponse.items;
    },
    traderPrices: async (gameMode = 'regular') => {
        const apiResponse = await FleaApiRequest(`/traders/offers`, {gameMode});
        if (!apiResponse.data) {
            return Promise.reject(new Error('Response missing data attribute'));
        }
        return apiResponse;
    },
    botsHealth: async () => {
        return BotApiRequest('/bot-health');
    },
    botRender: async () => {
        return BotApiRequest('/bot-render');
    },
    botGroups: async () => {
        return BotApiRequest('/bot-groups');
    },
    get: async (jsonName, options) => {
        const { download, gameMode } = merge(options);
        const saveFileName = `${jsonName}_${gameMode}.json`;
        if (download) {
            const returnValue = await limiter.schedule(() => DumpsApiRequest(jsonName, merge(options)));
            fs.mkdirSync(cachePath(), { recursive: true });
            fs.writeFileSync(cachePath(saveFileName), JSON.stringify(returnValue, null, 4));
            return returnValue;
        }
        try {
            return JSON.parse(fs.readFileSync(cachePath(saveFileName)));
        } catch (error) {
            if (error.code === 'ENOENT') {
                return spApi.get(jsonName, {...options, download: true});
            }
            return Promise.reject(error);
        }
    },
    downloadAll: async (options = defaultOptions) => {
        options = {...merge(options), download: true};
        const gameMode = gameModes.find(gm => gm.name === options.gameMode);
        const promises = [];
        const errors = {};
        const values = {};
        for (const jsonName in endpointList) {
            if (gameMode.skipData?.includes(jsonName)) {
                continue;
            }
            promises.push(spApi[jsonName](options)
                .then(data => {
                    values[jsonName] = data;
                })
                .catch(error => {
                    errors[jsonName] = error;
                })
            );
        }
        await Promise.all(promises);
        if (options.returnErrors && Object.values(errors).length > 0) {
            values.errors = errors;
            return values;
        }
        if (Object.keys(errors).length > 0) {
            return Promise.reject(new Error(Object.keys(errors).map(file => `${file}: ${errors[file].message}`).join('; ')));
        }
        return values;
    },
};

for (const jsonName in endpointList) {
    spApi[jsonName] = (options = defaultOptions) => {
        return spApi.get(jsonName, merge(options));
    };
}

export default spApi;
