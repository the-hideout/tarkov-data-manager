const fs = require('fs');
const path = require('path');

const got = require('got');

const BASE_URL = 'https://api.cloudflare.com/client/v4/';

const doRequest = async (cloudflarePath, method = 'GET', value, extraHeaders) => {
    const requestOptions = {
        method: method,
        headers: {
            'authorization': `Bearer ${process.env.CLOUDFLARE_TOKEN}`,
        },
    };

    if(extraHeaders){
        requestOptions.headers = {
            ...requestOptions.headers,
            ...extraHeaders,
        };
    }

    const fullCloudflarePath = `${cloudflarePath}`;

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