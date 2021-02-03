const fs = require('fs');
const path = require('path');

const got = require('got');

const loadData = async (name, url) => {
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

const getType = (itemId, bsgData, prevType) => {
      if(!bsgData[itemId]._parent){
          return prevType;
      }

      return getType(bsgData[itemId]._parent, bsgData, bsgData[itemId]._name)
};

module.exports = async () => {
    let bsgData = await loadData('all-bsg', 'https://tarkov-market.com/api/v1/bsg/items/all');
    let tmData = await loadData('all-tm', 'https://tarkov-market.com/api/v1/items/all?lang=en');

    const completeData = tmData.map((item) => {
        const bsgType = getType(item.bsgId, bsgData)
        return {
            ...item,
            ...bsgData[item.bsgId],
            bsgType: bsgType,
        };
    });

    return completeData;
};
