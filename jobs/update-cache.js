const roundTo = require('round-to');

const cloudflare = require('../modules/cloudflare');
const remoteData = require('../modules/remote-data');
const doQuery = require('../modules/do-query');

module.exports = async () => {
    const itemMap = await remoteData.get();
    const itemData = {};

    console.time('price-yesterday-query');
    const avgPriceYesterday = await doQuery(`SELECT
        avg(price) AS priceYesterday,
        item_id,
        timestamp
    FROM
        price_data
    WHERE
        timestamp > DATE_SUB(NOW(), INTERVAL 2 DAY)
    AND
        timestamp < DATE_SUB(NOW(), INTERVAL 1 DAY)
    GROUP BY
        item_id`);
    console.timeEnd('price-yesterday-query');

    console.time('last-low-price-query');
    const lastKnownPriceData = await doQuery(`SELECT
        price,
        a.timestamp,
        a.item_id
    FROM
        price_data a
    INNER JOIN (
        SELECT
            max(timestamp) as timestamp,
            item_id
        FROM
            price_data
        GROUP BY
            item_id
    ) b
    ON
        a.timestamp = b.timestamp
    GROUP BY
        item_id;`);
    console.timeEnd('last-low-price-query');

    for (const [key, value] of itemMap.entries()) {
        itemData[key] = value;

        Reflect.deleteProperty(itemData[key], 'last_update');
        Reflect.deleteProperty(itemData[key], 'last_scan');
        Reflect.deleteProperty(itemData[key], 'checked_out_by');
        Reflect.deleteProperty(itemData[key], 'trader_last_scan');
        Reflect.deleteProperty(itemData[key], 'trader_checked_out_by');
        Reflect.deleteProperty(itemData[key], 'scan_position');
        Reflect.deleteProperty(itemData[key], 'match_index');

        let itemPriceYesterday = avgPriceYesterday.find(row => row.item_id === key);

        if(!itemPriceYesterday || itemData[key].avg24hPrice === 0){
            itemData[key].changeLast48hPercent = 0;
        } else {
            const percentOfDayBefore = itemData[key].avg24hPrice / itemPriceYesterday.priceYesterday
            itemData[key].changeLast48hPercent = roundTo((percentOfDayBefore - 1) * 100, 2);
        }
        itemData[key].changeLast48h = itemData[key].changeLast48hPercent

        if(!itemData[key].lastLowPrice){
            let lastKnownPrice = lastKnownPriceData.find(row => row.item_id === key);
            if(lastKnownPrice){
                itemData[key].updated = lastKnownPrice.timestamp;
                itemData[key].lastLowPrice = lastKnownPrice.price;
            }
        }

        // itemData[key].changeLast48h = itemPriceYesterday.priceYesterday || 0;
    }

    try {
        const response = await cloudflare(`accounts/66766e138fce1ac1d2ef95953e037f4e/storage/kv/namespaces/f04e5b75ee894b3a90cec2b7cc351311/values/ITEM_CACHE`, 'PUT', JSON.stringify(itemData));
        console.log(response);
    } catch (requestError){
        console.error(requestError);
    }
};