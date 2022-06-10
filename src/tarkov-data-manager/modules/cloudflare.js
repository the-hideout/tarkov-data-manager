const fs = require('fs');
const path = require('path');

const got = require('got');

const BASE_URL = 'https://api.cloudflare.com/client/v4/';

const doRequest = async (key, method = 'GET', value, extraHeaders) => {
    if (!process.env.CLOUDFLARE_TOKEN) {
        fs.writeFileSync(path.join(__dirname, '..', 'dumps', `${key.split("/").pop().toLowerCase()}.json`), JSON.stringify(JSON.parse(value), null, 4));
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

    const fullCloudflarePath = `accounts/424ad63426a1ae47d559873f929eb9fc/storage/kv/namespaces/${namespace}/values/${key}`;

    const objectData = JSON.parse(value);

    fs.writeFileSync(path.join(__dirname, '..', 'dumps', `${key.split("/").pop().toLowerCase()}.json`), JSON.stringify(objectData, null, 4));

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

module.exports = doRequest;