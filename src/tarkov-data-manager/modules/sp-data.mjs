
const BASE_URL = process.env.SP_API_URL;

const ApiRequest = (path, options = {}) => {
    if (!path) {
        throw new Error('No path specified');
    }
    const url = new URL(`${BASE_URL}${path}`);
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.stringify(options.body) : undefined;
    if (options.params) {
        for (const paramName in options.params) {
            url.searchParams.set(paramName, options.params[paramName]);
        }
    }
    return fetch(url, {
        headers: {
            'X-API-KEY': process.env.SP_X_API_KEY,
            'CF-ACCESS-CLIENT-ID': process.env.SP_CF_ACCESS_CLIENT_ID,
            'CF-ACCESS-CLIENT-SECRET': process.env.SP_CF_ACCESS_CLIENT_SECRET,
        },
        method,
        body,
    });
};

const getGameType = (gameMode) => {
    if (gameMode === 'regular') {
        return 'eft';
    }
    return gameMode;
}

const spApi = {
    getFleaSummaryPrice: async (item, gameMode = 'regular') => {
        const response = await ApiRequest(`/flea/${getGameType(gameMode)}/item/${item.id}/price`);
        if (!response.ok) {
            if (response.status === 404) {
                return {
                    tarkov_id: item.id,
                    name: item.name,
                    short_name: item.shortName,
                    min_price: 0,
                    max_price: 0,
                    avg_price: 0,
                }
            }
            return Promise.reject(new Error(`${response.statusText} ${response.status} getting summary price for ${item.name} ${item.id}`));
        }
        const responseData = await response.json();
        if (!responseData.success) {
            return Promise.reject(new Error('Response did not indicate success'));
        }
        return responseData.data;
    },
    getAllSummaryPrices: async (gameMode = 'regular') => {
        const response = await ApiRequest(`/flea/${getGameType(gameMode)}/prices/all`);
        if (!response.ok) {
            return Promise.reject(new Error(`${response.statusText} ${response.status} getting summary prices`));
        }
        const responseData = await response.json();
        if (!responseData.success) {
            return Promise.reject(new Error('Response did not indicate success'));
        }
        return responseData.data;
    },
};

export default spApi;
