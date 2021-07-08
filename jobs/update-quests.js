const got = require('got');
const cloudflare = require('../modules/cloudflare');

module.exports = async () => {
    let data;

    try {
        data = await got('https://raw.githack.com/TarkovTracker/tarkovdata/master/quests.json', {
            responseType: 'json',
        });
    } catch (dataError){
        console.error(dataError);

        return false;
    }

    try {
        const response = await cloudflare(`accounts/66766e138fce1ac1d2ef95953e037f4e/storage/kv/namespaces/f04e5b75ee894b3a90cec2b7cc351311/values/QUEST_DATA`, 'PUT', JSON.stringify(data.body));
        console.log(response);
    } catch (requestError){
        console.error(requestError);
    }
}