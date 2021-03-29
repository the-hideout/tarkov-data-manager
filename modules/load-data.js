const fs = require('fs');
const path = require('path');

const got = require('got');

module.exports = async (name, url) => {
    const timestamp = `${new Date().getHours()}${new Date().getMinutes()}`;
    const fullFilePath = path.join(__dirname, '..', 'cache', `${name}-${timestamp}.json`);
    let cachedData;
    let response;

    try {
        cachedData = fs.readFileSync(fullFilePath);
    } catch (readError){
        // do nothing
    }

    if(cachedData){
        return JSON.parse(cachedData);
    }

    try {
        response = await got(url, {
            headers: {
                'x-api-key': process.env.TARKOV_MARKET_API_KEY,
            },
            responseType: 'json',
        });

    } catch (requestError){
        console.error(requestError);

        // We wan't CI to stop here
        process.exit(1);
    }

    fs.writeFileSync(fullFilePath, JSON.stringify(response.body, null, 4));

    return response.body;
};