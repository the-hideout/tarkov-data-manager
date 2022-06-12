const fs = require('fs');
const path = require('path');

const got = require('got');

const BASE_URL = 'https://api.cloudflare.com/client/v4/';

const doRequest = async (method = 'GET', operation, key, value, extraHeaders) => {
    if (!process.env.CLOUDFLARE_TOKEN) {
        return {
           result: null,
           success: false,
           errors: [`Cloudflare token not set; skipping ${method} ${key}`],
           messages: []
        };
    }
    const requestOptions = {
        method: method,
        headers: {
            'authorization': `Bearer ${process.env.CLOUDFLARE_TOKEN}`,
        },
        responseType: 'json'
    };

    if(extraHeaders){
        requestOptions.headers = {
            ...requestOptions.headers,
            ...extraHeaders,
        };
    }

    let namespace = process.env.NODE_ENV !== 'dev' ? '2e6feba88a9e4097b6d2209191ed4ae5' : '17fd725f04984e408d4a70b37c817171';
    //namespace = '2e6feba88a9e4097b6d2209191ed4ae5'; // force production

    let keyPath = '';
    if (key) keyPath = `/${key}`;

    const fullCloudflarePath = `accounts/424ad63426a1ae47d559873f929eb9fc/storage/kv/namespaces/${namespace}/${operation}${keyPath}`;

    if(value){
        requestOptions.body = value;
    }

    let response;

    try {
        response = await got(`${BASE_URL}${fullCloudflarePath}`, requestOptions);
    } catch (requestError){
        console.log(requestError);
    }

    return response.body;
};

const putValue = async (key, value) => {
    return doRequest('PUT', 'values', key, value).then(response => {
        fs.writeFileSync(path.join(__dirname, '..', 'dumps', `${key.split("/").pop().toLowerCase()}.json`), JSON.stringify(JSON.parse(value), null, 4));
        return response;
    });
};

const getKeys = async () => {
    return doRequest('GET', 'keys');
};

const getOldKeys = async () => {
    if (!process.env.CLOUDFLARE_TOKEN) {
        return {
           result: null,
           success: false,
           errors: [`Cloudflare token not set; skipping GET of old keys`],
           messages: []
        };
    }
    const requestOptions = {
        method: 'GET',
        headers: {
            'authorization': `Bearer ${process.env.CLOUDFLARE_TOKEN}`,
        },
        responseType: 'json'
    };
    const fullCloudflarePath = `accounts/424ad63426a1ae47d559873f929eb9fc/storage/kv/namespaces/2973a2dd070e4a348d87084171efe11a/keys`;
    let response;
    try {
        response = await got(`${BASE_URL}${fullCloudflarePath}`, requestOptions);
    } catch (requestError){
        console.log(requestError);
    }

    return response.body;
};

const deleteValue = async (key) => {
    if (!process.env.CLOUDFLARE_TOKEN) {
        return {
           result: null,
           success: false,
           errors: [`Cloudflare token not set; skipping DELETE of ${key}`],
           messages: []
        };
    }
    const requestOptions = {
        method: 'DELETE',
        headers: {
            'authorization': `Bearer ${process.env.CLOUDFLARE_TOKEN}`,
        },
        responseType: 'json'
    };
    const fullCloudflarePath = `accounts/424ad63426a1ae47d559873f929eb9fc/storage/kv/namespaces/2973a2dd070e4a348d87084171efe11a/values/${key}`;
    let response;
    try {
        response = await got(`${BASE_URL}${fullCloudflarePath}`, requestOptions);
    } catch (requestError){
        console.log(requestError);
    }

    return response.body;
};

const deleteValues = async (keys) => {
    if (!process.env.CLOUDFLARE_TOKEN) {
        return {
           result: null,
           success: false,
           errors: [`Cloudflare token not set; skipping DELETE ${keys.length} kv pairs`],
           messages: []
        };
    }
    if (!keys || !Array.isArray(keys) || keys.length > 10000) {
        return {
            result: null,
            success: false,
            errors: [`Must supply an array of keys (10,000 maximum) to delete`],
            messages: []
         };
    }
    const requestOptions = {
        method: 'DELETE',
        headers: {
            'authorization': `Bearer ${process.env.CLOUDFLARE_TOKEN}`,
        },
        responseType: 'json',
        body: JSON.stringify(keys)
    };
    const fullCloudflarePath = `accounts/424ad63426a1ae47d559873f929eb9fc/storage/kv/namespaces/2973a2dd070e4a348d87084171efe11a/bulk`;
    let response;
    try {
        response = await got(`${BASE_URL}${fullCloudflarePath}`, requestOptions);
    } catch (requestError){
        console.log(requestError);
    }

    return response.body;
};

module.exports = {
    put: putValue,
    getKeys: getKeys,
    //getOldKeys: getOldKeys,
    //delete: deleteValue,
    //deleteBulk: deleteValues
};
