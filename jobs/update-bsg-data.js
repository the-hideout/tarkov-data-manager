const fs = require('fs');
const path = require('path');

const got = require('got');

module.exports = async () => {
    let itemData;

    console.log('Loading bsg data');
    console.time('bsg-data');
    try {
        const response = await got(process.env.BSG_DATA_URL, {
            responseType: 'json'
        });

        itemData = response.body;
        console.timeEnd('bsg-data');
    } catch (gotError){
        throw gotError;
    }

    console.time('bsg-translation-data');
    try {
        const response = await got(process.env.BSG_TRANSLATIONS_URL, {
            responseType: 'json'
        });

        console.timeEnd('bsg-translation-data');

        for(const key in itemData){
            if(!itemData[key]._props){
                continue;
            }

            itemData[key]._props = {
                ...itemData[key]._props,
                ...response.body.templates[key],
            };
        }
    } catch (gotError){
        throw gotError;
    }

    console.time('bsg-base-price-data');
    try {
        const response = await got(process.env.BSG_BASE_PRICE_URL, {
            responseType: 'json'
        });

        console.timeEnd('bsg-base-price-data');

        for(const key in itemData){
            if(!itemData[key]._props){
                continue;
            }

            itemData[key]._props = {
                ...itemData[key]._props,
                CreditsPrice: response.body[key],
            };
        }
    } catch (gotError){
        throw gotError;
    }

    const writeData = {};
    let allKeys = Object.keys(itemData);

    allKeys.sort();

    for(const key of allKeys){
        writeData[key] = itemData[key];
    }

    fs.writeFileSync(path.join(__dirname, '..', 'bsg-data.json'), JSON.stringify(writeData, null, 4));
}