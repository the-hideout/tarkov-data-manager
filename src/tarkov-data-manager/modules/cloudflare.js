const fs = require('fs');
const path = require('path');

const got = require('got');

const BASE_URL = 'https://api.cloudflare.com/client/v4/';

const doRequest = async (cloudflarePath, method = 'GET', value, extraHeaders) => {
    if (!process.env.CLOUDFLARE_TOKEN) {
        return {
           result: null,
           success: false,
           errors: [`Cloudflare token not set; skipping ${method} ${cloudflarePath}`],
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

    const fullCloudflarePath = `accounts/424ad63426a1ae47d559873f929eb9fc/storage/kv/namespaces/2973a2dd070e4a348d87084171efe11a${cloudflarePath}`;

    const objectData = JSON.parse(value);

    fs.writeFileSync(path.join(__dirname, '..', 'dumps', `${fullCloudflarePath.split("/").pop().toLowerCase()}.json`), JSON.stringify(objectData, null, 4));

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