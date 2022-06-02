const fs = require('fs');
const path = require('path');

const got = require('got');
const moment = require('moment');

const cloudflare = require('../modules/cloudflare');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');

const traderMap = {
    'prapor': '54cb50c76803fa8b248b4571',
    'Prapor': '54cb50c76803fa8b248b4571',
    'therapist': '54cb57776803fa99248b456e',
    'Therapist': '54cb57776803fa99248b456e',
    'fence': '579dc571d53a0658a154fbec',
    'Fence': '579dc571d53a0658a154fbec',
    'skier': '58330581ace78e27b8b10cee',
    'Skier': '58330581ace78e27b8b10cee',
    'peacekeeper': '5935c25fb3acc3127c3d8cd9',
    'Peacekeeper': '5935c25fb3acc3127c3d8cd9',
    'mechanic': '5a7c2eca46aef81a7ca2145d',
    'Mechanic': '5a7c2eca46aef81a7ca2145d',
    'ragman': '5ac3b934156ae10c4430e83c',
    'Ragman': '5ac3b934156ae10c4430e83c',
    'jaeger': '5c0647fdd443bc2504c2d371',
    'Jaeger': '5c0647fdd443bc2504c2d371',
};

let logger = false;

const outputPrices = async (prices) => {
    //fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'trader-inventory.json'), JSON.stringify(prices, null, 4));

    try {
        const response = await cloudflare(`/values/TRADER_ITEMS_V2`, 'PUT', JSON.stringify(prices));
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
    logger = false;
};

module.exports = async () => {
    logger = new JobLogger('update-trader-prices');
    try {
        let tdQuests = {};
        try {
            const response = await got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/quests.json', {
                responseType: 'json',
            });
            tdQuests = response.body;
        } catch (error) {
            logger.error('Error downloading TarkovData quests');
            logger.error(error);
        }
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
        const currencyId = {
            'RUB': '5449016a4bdc2d6f028b456f',
            'USD': '5696686a4bdc2da3298b456a',
            'EUR': '569668774bdc2da2298b4568'
        };
        const credits = await tarkovChanges.credits();
        const currenciesNow = {
            'RUB': 1,
            'USD': Math.round(credits['5696686a4bdc2da3298b456a'] * 1.104271357),
            'EUR': Math.round(credits['569668774bdc2da2298b4568'] * 1.152974504)
        };
        const currenciesThen = {
            'RUB': 1
        };
        /*const currenciesLastScan = await query(`
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
        }*/
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
            if (currencyISO[traderItem.item_id]) {
                itemPrice = currenciesNow[currencyISO[traderItem.item_id]];
            }
            let questBsgId = null;
            if (!isNaN(parseInt(traderItem.quest_unlock_id))) {
                for (const quest of tdQuests) {
                    if (quest.id == traderItem.quest_unlock_id) {
                        questBsgId = quest.gameId;
                        break;
                    }
                }
                if (!questBsgId) {
                    logger.warn(`Could not find bsg id for quest ${traderItem.quest_unlock_id}`);
                }
            }
            const offer = {
                id: traderItem.item_id,
                vendor: {
                    trader: traderMap[traderItem.trader_name],
                    trader_id: traderMap[traderItem.trader_name],
                    traderLevel: traderItem.min_level,
                    minTraderLevel: traderItem.min_level,
                    taskUnlock: questBsgId
                },
                source: traderItem.trader_name,
                price: itemPrice,
                priceRUB: Math.round(itemPrice * currenciesNow[traderItem.currency]),
                updated: latestTraderPrices[traderItem.id].timestamp,
                quest_unlock: !isNaN(parseInt(traderItem.quest_unlock_id)),
                quest_unlock_id: traderItem.quest_unlock_id,
                currency: traderItem.currency,
                currencyItem: currencyId[traderItem.currency],
                requirements: [{
                    type: 'loyaltyLevel',
                    value: traderItem.min_level,
                }]
            };
            if (offer.quest_unlock) {
                offer.requirements.push({
                    type: 'questCompleted',
                    value: Number(offer.quest_unlock_id) || 1,
                    stringValue: questBsgId
                });
            }
            outputData[traderItem.item_id].push(offer);
        }

        await outputPrices(outputData);
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
        logger.end();
        jobComplete();
        logger = false;
    }
};
