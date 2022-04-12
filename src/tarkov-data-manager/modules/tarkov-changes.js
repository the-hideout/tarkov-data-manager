const got = require('got');

const jsonRequest = async (path) => {
    const response = await got(process.env.TC_URL+path, {
        method: 'post',
        username: process.env.TC_USERNAME,
        password: process.env.TC_PASSWORD,
        responseType: 'json',
        headers: {
            'Accept': 'application/json'
        }
    });
    if (!response.body) return Promise.reject(new Error(`Tarkov Changes returned null result for ${path}`));
    return response.body;
};

module.exports = {
    items: async () => {
        return jsonRequest('items.json');
    },
    crafts: async () => {
        return jsonRequest('crafts.json');
    },
    credits: async () => {
        return jsonRequest('credits.json');
    },
    en: async () => {
        return jsonRequest('locale_en.json');
    }
}