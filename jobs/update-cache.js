require('dotenv').config();

const cloudflare = require('../modules/cloudflare');
const remoteData = require('../modules/remote-data');

(async () => {
    const itemData = await remoteData.get();

    try {
        const response = await cloudflare(`accounts/66766e138fce1ac1d2ef95953e037f4e/storage/kv/namespaces/f04e5b75ee894b3a90cec2b7cc351311/values/ITEM_CACHE?expiration_ttl=600`, 'PUT', JSON.stringify(itemData));
        console.log(response);
    } catch (requestError){
        console.error(requestError);
    }
})();
