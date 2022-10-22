const got = require('got');
const moment = require('moment');

const cloudflare = require('../modules/cloudflare');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovData = require('../modules/tarkov-data');
const jobOutput = require('../modules/job-output');

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

let logger, tasks;

const outputPrices = async (prices) => {
    try {
        const response = await cloudflare.put('trader_price_data', JSON.stringify({
            updated: new Date(),
            data: prices,
        }));
        if (response.success) {
            logger.success(`Successful Cloudflare put of ${Object.keys(prices).length} trader prices`);
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

const getQuestUnlock = (traderItem) => {
    if (!isNaN(parseInt(traderItem.quest_unlock_id)) || traderItem.quest_unlock_bsg_id) {
        const traderId = traderMap[traderItem.trader_name];
        const itemId = traderItem.item_id;
        for (const quest of tasks) {
            const match = unlockMatches(itemId, quest.startRewards, traderId) || unlockMatches(itemId, quest.finishRewards, traderId);
            if (match) {
                return {
                    id: quest.id,
                    tarkovDataId: quest.tarkovDataId,
                    level: match.level
                };
            }
        }
        logger.warn(`Could not find quest unlock for trader offer ${traderItem.id}`);
    }
    return false;
};

const unlockMatches = (itemId, rewards, traderId) => {
    if (!rewards || !rewards.offerUnlock) return false;
    for (const unlock of rewards.offerUnlock) {
        if (unlock.trader_id !== traderId) continue;
        if (unlock.item === itemId) return unlock;
        if (unlock.base_item_id && unlock.base_item_id === itemId) return unlock;
    }
    return false;
};

module.exports = async () => {
    logger = new JobLogger('update-trader-prices');
    try {
        tasks = await jobOutput('update-quests', './dumps/quest_data.json', logger);
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
        const credits = await tarkovData.credits();
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

        const traderItems = await query(`
            SELECT
                *
            FROM
                trader_items;
        `);

        const traderPriceData = await query(`
            SELECT
                *
            FROM
                trader_price_data
            WHERE
                timestamp > ?;
        `, [scanOffsetTimestampMoment]);

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
            let minLevel = traderItem.min_level;
            const questUnlock = getQuestUnlock(traderItem);
            if (questUnlock) {
                minLevel = questUnlock.level;
            }
            const offer = {
                id: traderItem.item_id,
                vendor: {
                    trader: traderMap[traderItem.trader_name],
                    trader_id: traderMap[traderItem.trader_name],
                    traderLevel: minLevel,
                    minTraderLevel: minLevel,
                    taskUnlock: questUnlock ? questUnlock.id : null
                },
                source: traderItem.trader_name,
                price: itemPrice,
                priceRUB: Math.round(itemPrice * currenciesNow[traderItem.currency]),
                updated: latestTraderPrices[traderItem.id].timestamp,
                quest_unlock: questUnlock !== false,
                quest_unlock_id: traderItem.quest_unlock_id,
                currency: traderItem.currency,
                currencyItem: currencyId[traderItem.currency],
                requirements: [{
                    type: 'loyaltyLevel',
                    value: minLevel,
                }]
            };
            if (questUnlock) {
                offer.requirements.push({
                    type: 'questCompleted',
                    value: Number(questUnlock.tarkovDataId) || 1,
                    stringValue: questUnlock.id
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
