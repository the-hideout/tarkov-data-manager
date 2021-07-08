const fs = require('fs');
const path = require('path');

const cloudflare = require('../modules/cloudflare');
const doQuery = require('../modules/do-query');

module.exports = async () => {
    const traderItems = await doQuery(`SELECT
        *
    FROM
        trader_items;`);

    const traderPriceData = await doQuery(`SELECT
        *
    FROM
        trader_price_data;`);

    const latestTraderPrices = {};

    for(const traderPrice of traderPriceData){
        if(!latestTraderPrices[traderPrice.trade_id]){
            latestTraderPrices[traderPrice.trade_id] = {
                price: traderPrice.price,
                timestamp: traderPrice.timestamp,
            };

            continue;
        }

        if(latestTraderPrices[traderPrice.trade_id].timestamp.getTime() > traderPrice.timestamp.getTime()){
            continue;
        }

        latestTraderPrices[traderPrice.trade_id] = {
            price: traderPrice.price,
            timestamp: traderPrice.timestamp,
        };
    }

    const outputData = {};

    for(const traderItem of traderItems){
        if(!latestTraderPrices[traderItem.id]){
            continue;
        }

        if(!outputData[traderItem.item_id]){
            outputData[traderItem.item_id] = [];
        }

        outputData[traderItem.item_id].push({
            id: traderItem.item_id,
            source: traderItem.trader_name,
            min_level: traderItem.min_level,
            price: latestTraderPrices[traderItem.id].price,
            updated: latestTraderPrices[traderItem.id].timestamp,
            quest_unlock: Boolean(traderItem.quest_unlock_id),
            quest_unlock_id: Number(traderItem.quest_unlock_id),
            currency: traderItem.currency,
        });
    }

    fs.writeFileSync(path.join(__dirname, 'dumps', 'trader-inventory.json'), JSON.stringify(outputData, null, 4));

    try {
        const response = await cloudflare(`accounts/66766e138fce1ac1d2ef95953e037f4e/storage/kv/namespaces/f04e5b75ee894b3a90cec2b7cc351311/values/TRADER_ITEMS`, 'PUT', JSON.stringify(outputData));
        console.log(response);
    } catch (requestError){
        console.error(requestError);
    }
};