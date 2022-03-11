const got = require('got');
const cloudflare = require('../modules/cloudflare');

module.exports = async () => {
    let data;

    try {
        data = await got('https://raw.githack.com/TarkovTracker/tarkovdata/master/hideout.json', {
            responseType: 'json',
        });
    } catch (dataError){
        console.error(dataError);

        return false;
    }

    const hideoutData = {
        updated: new Date(),
        data: data.body.modules,
    };

    try {
        const response = await cloudflare(`/values/HIDEOUT_DATA`, 'PUT', JSON.stringify(hideoutData));
        console.log(response);
    } catch (requestError){
        console.error(requestError);
    }
}