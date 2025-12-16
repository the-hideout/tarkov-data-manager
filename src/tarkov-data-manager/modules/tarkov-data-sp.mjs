
const BASE_URL = process.env.SP_API_URL;

const ApiRequest = async (path, options = {}) => {
    if (!path) {
        throw new Error('No path specified');
    }
    const url = new URL(`https://publicfleaapi.asoloproject.xyz/api/v2${path}`);
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

const getGameType = (gameMode) => {
    if (gameMode === 'regular') {
        return 'eft';
    }
    return gameMode;
}

const spApi = {
    itemsOverview: async (gameMode = 'regular') => {
        const apiResponse = await ApiRequest(`/flea-advanced/${getGameType(gameMode)}/items-overview`);
        if (!apiResponse.items) {
            return Promise.reject(new Error('Response missing items attribute'));
        }
        return apiResponse.items;
    },
    traderPrices: async (gameMode = 'regular') => {
        const apiResponse = await ApiRequest(`/flea-advanced/${getGameType(gameMode)}/traders/offers`);
        if (!apiResponse.data) {
            return Promise.reject(new Error('Response missing data attribute'));
        }
        return apiResponse;
    },
    botsHealth: async () => {
        const response = await fetch('https://tarkovbotroleapi.asoloproject.xyz/api/bot-health');
        if (!response.ok) {
            return Promise.reject(new Error(`${response.statusText} ${response.status}`));
        }
        return response.json();
    },
};

export default spApi;
