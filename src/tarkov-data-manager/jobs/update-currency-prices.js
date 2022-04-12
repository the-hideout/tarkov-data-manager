const fs = require('fs');
const path = require('path');

const cloudflare = require('../modules/cloudflare');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');

module.exports = async () => {
    const logger = new JobLogger('update-currency-prices');
    const currencyPrices = await query(`
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

    const outputData = {};

    for(const currencyPrice of currencyPrices){
        outputData[currencyPrice.item_id] = [{
            id: currencyPrice.item_id,
            source: currencyPrice.trader_name,
            min_level: currencyPrice.min_level,
            price: currencyPrice.price,
            updated: currencyPrice.price_timestamp,
            quest_unlock: Boolean(currencyPrice.quest_unlock_id),
            quest_unlock_id: currencyPrice.quest_unlock_id,
            currency: currencyPrice.currency,
        }];
    }

    //fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'currency-prices.json'), JSON.stringify(outputData, null, 4));

    try {
        const response = await cloudflare(`/values/CURRENCY_PRICES`, 'PUT', JSON.stringify(outputData));
        if (response.success) {
            logger.success('Successful Cloudflare put of CURRENCY_PRICES');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                logger.error(response.messages[i]);
            }
        }
    } catch (requestError){
        logger.error(requestError);
    }

    // Possibility to POST to a Discord webhook here with cron status details
    logger.end();
    await jobComplete();
};