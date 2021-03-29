const https = require('https');

const BTC_PER_ITEM = 0.18;

module.exports = () => {
    return new Promise((resolve, reject) => {
        https.get('https://api.coindesk.com/v1/bpi/currentprice/rub.json', (res) => {
            console.log('statusCode:', res.statusCode);
            console.log('headers:', res.headers);

            res.on('data', (d) => {
                const parsedData = JSON.parse(d);

                console.log(parsedData);
                resolve(Math.floor(parsedData.bpi.RUB.rate_float * BTC_PER_ITEM));
            });
        }).on('error', (e) => {
            reject(e);
        });
    });
}
