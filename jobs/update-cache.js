require('dotenv').config();

const cloudflare = require('../modules/cloudflare');
const remoteData = require('../modules/remote-data');

function replacer(key, value) {
    if(value instanceof Map) {
        return {
            dataType: 'Map',
            value: Array.from(value.entries()), // or with spread: value: [...value]
        };
    } else {
        return value;
    }
}

module.exports = async () => {
    console.log('Running cache update');
    const itemMap = await remoteData.get();
    const itemData = {};

    for (const [key, value] of itemMap.entries()) {
        itemData[key] = value;
    }

    try {
        const response = await cloudflare(`accounts/66766e138fce1ac1d2ef95953e037f4e/storage/kv/namespaces/f04e5b75ee894b3a90cec2b7cc351311/values/ITEM_CACHE?expiration_ttl=600`, 'PUT', JSON.stringify(itemData));
        console.log(response);
    } catch (requestError){
        console.error(requestError);
    }
};