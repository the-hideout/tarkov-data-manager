const fs = require('fs');
const path = require('path');

const got = require('got');

const BASE_URL = 'https://api.cloudflare.com/client/v4/';

const doRequest = async (cloudflarePath, method = 'GET', value) => {
    const requestOptions = {
        method: method,
        headers: {
            'authorization': `Bearer ${process.env.CLOUDFLARE_TOKEN}`,
        },
    };

    const objectData = JSON.parse(value);

    fs.writeFileSync(path.join(__dirname, '..', 'dumps', `${cloudflarePath.split("/").pop().toLowerCase()}.json`), JSON.stringify(objectData, null, 4));

    if(value){
        requestOptions.body = value;
    }

    let response;

    try {
        response = await got(`${BASE_URL}${cloudflarePath}`, requestOptions);
    } catch (requestError){
        console.log(requestError);
    }

    return response.body;
};

module.exports = doRequest;