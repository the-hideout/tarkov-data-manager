const fs = require('fs');
const path = require('path');

const roundTo = require('round-to');

const cloudflare = require('../modules/cloudflare');
const remoteData = require('../modules/remote-data');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');

module.exports = async () => {
    const logger = new JobLogger('update-cache');
    try {
        const itemMap = await remoteData.get(true);
        const itemData = {};

        logger.time('price-yesterday-query');
        const avgPriceYesterday = await query(`SELECT
            avg(price) AS priceYesterday,
            item_id
        FROM
            price_data
        WHERE
            timestamp > DATE_SUB(NOW(), INTERVAL 2 DAY)
        AND
            timestamp < DATE_SUB(NOW(), INTERVAL 1 DAY)
        GROUP BY
            item_id`);
        logger.timeEnd('price-yesterday-query');

        logger.time('last-low-price-query');
        const lastKnownPriceData = await query(`SELECT
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
            WHERE
                timestamp > '2021-12-12 01:00:00'
            GROUP BY
                item_id
        ) b
        ON
            a.timestamp = b.timestamp
        GROUP BY
            item_id, timestamp, price;`);
        logger.timeEnd('last-low-price-query');

        logger.time('contained-items-query');
        const containedItems = await query(`SELECT
            *
        FROM
            item_children;`);
        logger.timeEnd('contained-items-query');

        let containedItemsMap = {};

        for (const result of containedItems) {
            if (!containedItemsMap[result.container_item_id]) {
                containedItemsMap[result.container_item_id] = [];
            }

            containedItemsMap[result.container_item_id].push({
                itemId: result.child_item_id,
                count: result.count,
            });
        }

        for (const [key, value] of itemMap.entries()) {
            itemData[key] = value;

            Reflect.deleteProperty(itemData[key], 'last_update');
            Reflect.deleteProperty(itemData[key], 'last_scan');
            Reflect.deleteProperty(itemData[key], 'checked_out_by');
            Reflect.deleteProperty(itemData[key], 'trader_last_scan');
            Reflect.deleteProperty(itemData[key], 'trader_checked_out_by');
            Reflect.deleteProperty(itemData[key], 'scan_position');
            Reflect.deleteProperty(itemData[key], 'match_index');

            // Only add these if it's allowed on the flea market
            if (!itemData[key].types.includes('no-flea')) {
                let itemPriceYesterday = avgPriceYesterday.find(row => row.item_id === key);

                if (!itemPriceYesterday || itemData[key].avg24hPrice === 0) {
                    itemData[key].changeLast48hPercent = 0;
                } else {
                    const percentOfDayBefore = itemData[key].avg24hPrice / itemPriceYesterday.priceYesterday
                    itemData[key].changeLast48hPercent = roundTo((percentOfDayBefore - 1) * 100, 2);
                }
                itemData[key].changeLast48h = itemData[key].changeLast48hPercent

                if (!itemData[key].lastLowPrice) {
                    let lastKnownPrice = lastKnownPriceData.find(row => row.item_id === key);
                    if (lastKnownPrice) {
                        itemData[key].updated = lastKnownPrice.timestamp;
                        itemData[key].lastLowPrice = lastKnownPrice.price;
                    }
                }
            }

            itemData[key].containsItems = containedItemsMap[key];

            // itemData[key].changeLast48h = itemPriceYesterday.priceYesterday || 0;
        }
        const response = await cloudflare(`/values/ITEM_CACHE`, 'PUT', JSON.stringify(itemData)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of ITEM_CACHE');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                logger.error(response.messages[i]);
            }
        }
        fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'item-cache.json'), JSON.stringify(itemData, null, 4));

        // Possibility to POST to a Discord webhook here with cron status details
    } catch (error) {
        logger.error(error);
    }
    await jobComplete();
    logger.end();
};