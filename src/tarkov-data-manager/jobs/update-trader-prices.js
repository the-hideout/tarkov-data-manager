const fs = require('fs');
const path = require('path');

const cloudflare = require('../modules/cloudflare');
const doQuery = require('../modules/do-query');

module.exports = async () => {
    const junkboxLastScan = await doQuery(`SELECT
        *
    FROM
        trader_price_data
    WHERE
        trade_id = 799
    ORDER BY
        timestamp
        desc
    LIMIT 1`);
    if (junkboxLastScan.lengh === 0) {
        try {
            const response = await cloudflare(`/values/TRADER_ITEMS`, 'PUT', JSON.stringify({}));
            console.log(response);
        } catch (requestError){
            console.error(requestError);
        }
        return;
    }

    const scanOffsetTimestamp = new Date(junkboxLastScan[0].timestamp).setHours(junkboxLastScan[0].timestamp.getHours() - 6);

    const currencyISO = {
        '5696686a4bdc2da3298b456a': 'USD',
        '569668774bdc2da2298b4568': 'EUR'
    }
    const currenciesNow = {
        'RUB': 1
    };
    const currenciesThen = {
        'RUB': 1
    };
    const currenciesLastScan = await doQuery(`
        SELECT
            item_id, trader_name, currency, min_level, quest_unlock_id,
            price, trader_items.timestamp as offer_timestamp, trader_price_data.timestamp as price_timestamp
        FROM
            trader_items
        INNER JOIN 
            trader_price_data
        ON
            trader_items.id=trader_price_data.trade_id
        WHERE
            item_id in ('5696686a4bdc2da3298b456a', '569668774bdc2da2298b4568') AND
            trader_price_data.timestamp=(
                SELECT 
                    timestamp 
                FROM 
                    trader_price_data
                WHERE 
                    trade_id=trader_items.id
                ORDER BY timestamp DESC
                LIMIT 1
            );
    `);
    for (const curr of currenciesLastScan) {
        currenciesNow[currencyISO[curr.item_id]] = curr.price;
    }
    const currenciesHistoricScan = await doQuery(`
        SELECT
            item_id, trader_name, currency, min_level, quest_unlock_id,
            price, trader_items.timestamp as offer_timestamp, trader_price_data.timestamp as price_timestamp
        FROM
            trader_items
        INNER JOIN 
            trader_price_data
        ON
            trader_items.id=trader_price_data.trade_id
        WHERE
            item_id in ('5696686a4bdc2da3298b456a', '569668774bdc2da2298b4568') AND
            trader_price_data.timestamp=(
                SELECT 
                    tpd.timestamp 
                FROM 
                    trader_price_data tpd
                WHERE 
                    tpd.trade_id=trader_items.id
                ORDER BY abs(UNIX_TIMESTAMP(tpd.timestamp) - ?)
                LIMIT 1
            );
    `, junkboxLastScan[0].timestamp.getTime()/1000);
    for (const curr of currenciesHistoricScan) {
        currenciesThen[currencyISO[curr.item_id]] = curr.price;
    }

    const traderItems = await doQuery(`SELECT
        *
    FROM
        trader_items;`);

    const traderPriceData = await doQuery(`SELECT
        *
    FROM
        trader_price_data
    WHERE
        timestamp > ?;`, [scanOffsetTimestamp[0].timestamp]);

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

        let itemPrice = latestTraderPrices[traderItem.id].price;
        if (traderItem.currency !== 'RUB' && currenciesThen[traderItem.currency] && currenciesNow[traderItem.currency]) {
            const rublesCost = currenciesThen[traderItem.currency]*itemPrice;
            itemPrice = Math.ceil(rublesCost / currenciesNow[traderItem.currency]);
        }
        outputData[traderItem.item_id].push({
            id: traderItem.item_id,
            source: traderItem.trader_name,
            min_level: traderItem.min_level,
            price: itemPrice,
            updated: latestTraderPrices[traderItem.id].timestamp,
            quest_unlock: Boolean(traderItem.quest_unlock_id),
            quest_unlock_id: traderItem.quest_unlock_id,
            currency: traderItem.currency,
        });
    }

    fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'trader-inventory.json'), JSON.stringify(outputData, null, 4));

    try {
        const response = await cloudflare(`/values/TRADER_ITEMS`, 'PUT', JSON.stringify(outputData));
        console.log(response);
    } catch (requestError){
        console.error(requestError);
    }
};