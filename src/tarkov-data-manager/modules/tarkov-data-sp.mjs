
const ApiRequest = async (url, options = {}) => {
    if (!url) {
        throw new Error('No url specified');
    }
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.stringify(options.body) : undefined;
    if (options.params) {
        for (const paramName in options.params) {
            url.searchParams.set(paramName, options.params[paramName]);
        }
    }
    const response = await fetch(url, {
        method,
        body,
        signal: options.signal ?? AbortSignal.timeout(30000),
    });
    if (!response.ok) {
        return Promise.reject(new Error(`${response.statusText} ${response.status}`));
    }
    return response.json();
};

const FleaApiRequest = async (path, options = {}) => {
    const gameType = getGameType(options.gameMode ?? 'regular');
    const url = new URL(`https://publicfleaapi.asoloproject.xyz/api/v2/flea-advanced/${gameType}${path}`);
    return ApiRequest(url, options);
};

const BotApiRequest = async (path, options) => {
    const url = new URL(`https://tarkovbotroleapi.asoloproject.xyz/api${path}`);
    return ApiRequest(url, options);
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

const spApi = {
    itemsOverview: async (gameMode = 'regular') => {
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
};

export default spApi;
