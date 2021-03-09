const got = require('got');

const cloudflare = require('../modules/cloudflare');
const itemIds = require('./items.json');

const arrayChunk = (inputArray, chunkLength) => {
    return inputArray.reduce((resultArray, item, index) => {
        const chunkIndex = Math.floor(index / chunkLength);

        if(!resultArray[chunkIndex]) {
            resultArray[chunkIndex] = []; // start a new chunk
        }

        resultArray[chunkIndex].push(item);

        return resultArray
    }, []);
};

(async () => {
    let tempData = {};

    try {
        const chunks = arrayChunk(itemIds, 500);
        let i = 1;
        for(const chunk of chunks){
            console.time(`tt-api-chunk-${i}`);
            const bodyQuery = JSON.stringify({query: `{
                    ${chunk.map((itemId) => {
                        return `item${itemId}: item(id:"${itemId}"){
                            id
                            name
                            shortName
                            basePrice
                            width
                            height
                            iconLink
                            wikiLink
                            imageLink
                            types
                            avg24hPrice
                            accuracyModifier
                            recoilModifier
                            ergonomicsModifier
                        }`;
                    }).join('\n') }
                }`
            });
            const response = await got.post('https://tarkov-tools.com/graphql', {
                body: bodyQuery,
                responseType: 'json',
            });
            console.timeEnd(`tt-api-chunk-${i}`);

            if(response.body.errors){
                console.error(response.body.errors);
            }

            for(const item of Object.values(response.body.data)){
                tempData[item.id] = item;
            }

            i = i + 1;
        }

    } catch (requestError){
        console.error(requestError);

        // We wan't CI to stop here
        process.exit(1);
    }

    try {
        const response = await cloudflare(`accounts/66766e138fce1ac1d2ef95953e037f4e/storage/kv/namespaces/f04e5b75ee894b3a90cec2b7cc351311/values/ITEM_CACHE?expiration_ttl=600`, 'PUT', JSON.stringify(tempData));
        console.log(response);
    } catch (requestError){
        console.error(requestError);
    }

    try {
        await cloudflare(`accounts/66766e138fce1ac1d2ef95953e037f4e/storage/kv/namespaces/f04e5b75ee894b3a90cec2b7cc351311/values/ITEM_CACHE`);
    } catch (requestError){
        console.error(requestError);
    }
})();
