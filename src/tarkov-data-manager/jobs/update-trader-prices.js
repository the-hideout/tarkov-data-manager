const fs = require('fs');
const path = require('path');

const moment = require('moment');

const cloudflare = require('../modules/cloudflare');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

let logger = false;

const outputPrices = async (prices) => {
    fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'trader-inventory.json'), JSON.stringify(prices, null, 4));

    try {
        const response = await cloudflare(`/values/TRADER_ITEMS`, 'PUT', JSON.stringify(prices));
        if (response.success) {
            logger.success(`Successful Cloudflare put of ${Object.keys(prices).length} TRADER_ITEMS`);
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

module.exports = async () => {
    logger = new JobLogger('update-trader-prices');
    try {
        const outputData = {};
        const junkboxLastScan = await query(`
            SELECT
                trader_price_data.*
            FROM
                trader_price_data
            INNER JOIN
                trader_items
            ON
                trader_items.id=trader_price_data.trade_id
            WHERE
                item_id = '5b7c710788a4506dec015957'
            ORDER BY
            trader_price_data.timestamp
                desc
            LIMIT 1
        `);
        if (junkboxLastScan.length === 0) {
            await outputPrices(outputData);
            return;
        }

        const scanOffsetTimestampMoment = moment(junkboxLastScan[0].timestamp).subtract(6, 'hours').format("YYYY-MM-DD HH:mm:ss");
        //const scanOffsetTimestamp = new Date(junkboxLastScan[0].timestamp).setHours(junkboxLastScan[0].timestamp.getHours() - 6);

        logger.log('Trader price cutoff:')
        logger.log(scanOffsetTimestampMoment);
        
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
        const currenciesLastScan = await query(`
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
        const currenciesHistoricScan = await query(`
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

        const traderItems = await query(`SELECT
            *
        FROM
            trader_items;`);

        const traderPriceData = await query(`SELECT
            *
        FROM
            trader_price_data
        WHERE
            timestamp > ?;`, [scanOffsetTimestampMoment]);

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

        await outputPrices(outputData);
    } catch (error) {
        logger(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
        logger.end();
        jobComplete();
    }
};
