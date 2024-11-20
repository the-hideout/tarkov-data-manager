//import zlib from 'zlib';

import got from 'got';

import sleep from './sleep.js';

const BASE_URL = 'https://api.cloudflare.com/client/v4/';

const doRequest = async (options = {}) => {
    if (!options.path) {
        return Promise.reject(new Error('Must specify path for cloudflare request'));
    }
    const method = options.method ?? 'GET';
    const path = options.path;
    const body = options.body;

    if (!process.env.CLOUDFLARE_TOKEN) {
        return {
           result: null,
           success: false,
           errors: [`Cloudflare token not set; skipping ${method} ${path}`],
           messages: []
        };
    }
    const requestOptions = {
        method: method,
        headers: {
            'authorization': `Bearer ${process.env.CLOUDFLARE_TOKEN}`,
            ...options.headers,
        },
        responseType: 'json',
        resolveBodyOnly: true,
        retry: {
            limit: 3,
            methods: ['GET', 'PUT', 'POST', 'DELETE'],
        },
        timeout: {
            response: 20000,
        },
        signal: options.signal,
    };

    let namespace = process.env.NODE_ENV === 'production' ? '2e6feba88a9e4097b6d2209191ed4ae5' : '17fd725f04984e408d4a70b37c817171';
    //namespace = '2e6feba88a9e4097b6d2209191ed4ae5'; // force production

    const fullCloudflarePath = `accounts/424ad63426a1ae47d559873f929eb9fc/storage/kv/namespaces/${namespace}/${path}`;

    if (body){
        if (options.metadata) {
            const form = new FormData();
            form.append('value', body);
            form.append('metadata', JSON.stringify(options.metadata));
            requestOptions.body = form;
        } else {
            requestOptions.body = body;
        }
    }

    return got(`${BASE_URL}${fullCloudflarePath}`, requestOptions).catch(error => {
        return {
            success: false,
            errors: [error],
            messages: [],
        }
    });
};

export const getKeys = async () => {
    return doRequest({path: 'keys'});
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

export const purgeCache = async (urls) => {
    if (typeof urls === 'string') {
        urls = [urls];
    }
    const requestOptions = {
        method: 'POST',
        headers: {
            'authorization': `Bearer ${process.env.CLOUDFLARE_TOKEN}`,
        },
        responseType: 'json',
        //resolveBodyOnly: true,
        json: {
            files: urls
        },
        throwHttpErrors: false,
        resolveBodyOnly: true,
    };
    return got(`${BASE_URL}zones/a17204c79af55fcf05e4975f66e2490e/purge_cache`, requestOptions).then(response => {
        if (response.success === false && response.errors) {
            //console.log(`Error purging ${urls.join(', ')}: ${response.errors.map(err => err.message).join(', ')}`);
            return Promise.reject(new Error(`${response.errors[0].message} (${response.errors[0].code}) purging ${urls.join(', ')}: `));
        }
        return response;
    });
};

const cloudflare = {
    put: (key, value, options = {}) => {
        const encoding = 'base64';
        if (typeof value === 'object'){
            value = JSON.stringify(value);
        } 
        //return doRequest('PUT', 'values', key, zlib.gzipSync(value).toString(encoding), false, {compression: 'gzip', encoding: encoding}).then(response => {
        return doRequest({method: 'PUT', path: `values/${key}`, body: value, ...options});
    },
    getKeys: getKeys,
    purgeCache: purgeCache,
    //getOldKeys: getOldKeys,
    //delete: deleteValue,
    //deleteBulk: deleteValues
    d1Query: async (query, params, options = {}) => {
        if (!process.env.CLOUDFLARE_TOKEN) {
            return Promise.reject(new Error('Cannot query; CLOUDFLARE_TOKEN is not set'));
        }
        const response = await fetch(`${BASE_URL}accounts/424ad63426a1ae47d559873f929eb9fc/d1/database/6b25079c-ab80-41ba-bbe8-ed0f2913f87e/query`, {
            method: 'POST',
            headers: {
                'authorization': `Bearer ${process.env.CLOUDFLARE_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                params: params ?? [],
                sql: query,
            }),
        });
        if (!response.ok) {
            if (options.maxRetries) {
                if (!options.attempt) {
                    options.attempt = 1;
                }
                if (!options.retryDelay) {
                    options.retryDelay = 1000;
                }
                if (options.attempt <= options.maxRetries) {
                    options.attempt++;
                    await sleep(options.retryDelay);
                    return cloudflare.d1Query(query, params, options);
                }
            }
            return Promise.reject(new Error(`${response.status} ${response.statusText}`));
        }
        const result = await response.json();
        if (!result.success && result.errors) {
            return Promise.reject(new Error(`${result.errors[0].message} (${result.errors[0].code})`));
        }
        return result.result[0];
    },
};

export const { put } = cloudflare;

export default cloudflare;
