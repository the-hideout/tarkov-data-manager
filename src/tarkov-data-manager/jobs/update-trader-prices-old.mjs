import { DateTime } from 'luxon';

import DataJob from '../modules/data-job.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import remoteData from '../modules/remote-data.mjs';

class UpdateTraderPricesJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-trader-prices'});
        this.writeFolder = 'cache';
        this.kvName = 'trader_price_data';
    }

    async run() {
        [this.tasks, this.traders, this.traderAssorts, this.presets, this.items, this.localeEn] = await Promise.all([
            this.jobManager.jobOutput('update-quests', this),
            tarkovData.traders(),
            this.jobManager.jobOutput('update-trader-assorts', this, 'regular', true),
            this.jobManager.jobOutput('update-presets', this),
            remoteData.get(),
            tarkovData.locale('en'),
        ]);
        for (const traderId in this.traderAssorts) {
            this.traderAssorts[traderId] = this.traderAssorts[traderId].filter(offer => !offer.barter);
        }
        const outputData = {};
        const junkboxLastScan = await this.query(`
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
            return this.outputPrices(outputData);
        }

        const scanOffsetTimestampDate = DateTime.fromJSDate(junkboxLastScan[0].timestamp).minus({hours: 6}).toFormat('yyyy-LL-dd HH:mm:ss');
        //const scanOffsetTimestamp = new Date(junkboxLastScan[0].timestamp).setHours(junkboxLastScan[0].timestamp.getHours() - 6);

        this.logger.log('Trader price cutoff:')
        this.logger.log(scanOffsetTimestampDate);
        
        const currencyISO = {
            '5449016a4bdc2d6f028b456f': 'RUB',
            '5696686a4bdc2da3298b456a': 'USD',
            '569668774bdc2da2298b4568': 'EUR'
        }
        this.currencyId = {
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

        const [currenciesHistoricScan, traderItems, traderPriceData] = await Promise.all([
            this.query(`
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
            `, [junkboxLastScan[0].timestamp.getTime()/1000]),
            this.query(`
                SELECT
                    *
                FROM
                    trader_items
                WHERE
                    NOT EXISTS (SELECT type FROM types WHERE trader_items.item_id = types.item_id AND type = 'only-flea');
            `),
            this.query(`
                SELECT
                    *
                FROM
                    trader_price_data
                WHERE
                    timestamp > ?;
            `, [scanOffsetTimestampDate]),
        ]);
        for (const curr of currenciesHistoricScan) {
            currenciesThen[currencyISO[curr.item_id]] = curr.price;
        }

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

        for (const traderItem of traderItems){
            if (!latestTraderPrices[traderItem.id]) {
                continue;
            }
            if (this.items.get(traderItem.item_id).types.includes('disabled')) {
                const item = this.items.get(traderItem.item_id);
                this.logger.warn(`Skipping disabled item ${item.name} ${item.id}`);
                continue;
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
            let questUnlock = false;
            try {
                questUnlock = this.getQuestUnlock(traderItem);
                if (questUnlock) {
                    minLevel = questUnlock.level;
                }
            } catch (error) {
                this.logger.warn(error.message);
                continue;
            }
            const trader = this.getTraderByName(traderItem.trader_name);
            const offer = {
                id: traderItem.item_id,
                item_name: this.items.get(traderItem.item_id).name,
                vendor: {
                    trader: trader._id,
                    trader_id: trader._id,
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
                currencyItem: this.currencyId[traderItem.currency],
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
            const matchingTraderOffers = this.traderAssorts[trader._id].reduce((matches, traderOffer) => {
                if (traderOffer.item !== offer.id && traderOffer.baseItem !== offer.id) {
                    return matches;
                }
                if (Boolean(traderOffer.taskUnlock) !== Boolean(offer.vendor.taskUnlock)) {
                    return matches;
                }
                if (!offer.vendor.taskUnlock) {
                    if (traderOffer.minLevel !== offer.vendor.minTraderLevel) {
                        return matches;
                    }
                }
                matches.push(traderOffer);
                return matches;
            }, []);
            if (matchingTraderOffers.length > 0) {
                for ( const matchedOffer of matchingTraderOffers) {
                    const item = await this.items.get(matchedOffer.item);
                    if (item.types.includes('disabled')) {
                        this.logger.warn(`Skipping disabled item ${item.name} ${item.id}`);
                        continue;
                    }
                    if (item.types.includes('preset')) {
                        offer.id = matchedOffer.item;
                        offer.item_name = matchedOffer.itemName;
                    }
                    if (item.types.includes('preset') || item.types.includes('gun')) {
                        offer.price = Math.ceil(matchedOffer.cost[0].count);
                        offer.priceRUB = Math.round(matchedOffer.cost[0].count * currenciesNow[currencyISO[matchedOffer.cost[0].item]]);
                    }
                    offer.restockAmount = matchedOffer.stock;
                    offer.buyLimit = matchedOffer.buyLimit;
                    offer.traderOfferId = matchedOffer.id;
                    break;
                }
            } else {
                offer.traderOfferId = `${offer.id}-${offer.vendor.trader}-${offer.vendor.traderLevel}-${offer.currencyItem}`;
                //this.logger.warn('Could not match assort for offer');
                //this.logger.log(JSON.stringify(offer, null, 4));
            }
            if (!outputData[offer.id]) {
                outputData[offer.id] = [];
            }
            outputData[offer.id].push(offer);
        }
        this.logger.log('Checking assorts for missing offers...');
        for (const traderId in this.traderAssorts) {
            const trader = this.traders[traderId];
            const traderName = this.localeEn[`${traderId} Nickname`];
            const traderNormalizedName = this.normalizeName(traderName);
            this.traderAssorts[traderId].forEach(offer => {
                const traderOfferUsed = Object.keys(outputData).some(id => {
                    for (const to of outputData[id]) {
                        if (to.traderOfferId === offer.id) {
                            return true;
                        }
                    }
                    return false;
                });
                if (traderOfferUsed) {
                    return;
                }
                let itemId = offer.item;
                const item = this.items.get(itemId);
                if (!item.types.includes('preset') && offer.contains.length > 0) {
                    this.logger.log(`Could not match preset for ${item.name} ${traderName} ${offer.id}`);
                    console.log(offer);
                    return;
                }
                if (!item.types.includes('preset') && !item.types.includes('gun')) {
                    return;
                }
                if (item.types.includes('disabled')) {
                    this.logger.warn(`Skipping disabled item ${item.name} ${item.id}`);
                    return;
                }
                if (outputData[itemId]) {
                    const matchedOffer = outputData[itemId].some(o => {
                        if (o.vendor.trader !== traderId) {
                            return false;
                        }
                        return true;
                    });
                    if (matchedOffer) {
                        return;
                    }
                }
                const newOffer = {
                    id: itemId,
                    item_name: item.name,
                    vendor: {
                        trader: traderId,
                        trader_id: traderId,
                        traderLevel: offer.minLevel,
                        minTraderLevel: offer.minLevel,
                        taskUnlock: offer.taskUnlock ? offer.taskUnlock : null
                    },
                    source: traderNormalizedName,
                    price: Math.ceil(offer.cost[0].count),
                    priceRUB: Math.round(offer.cost[0].count * currenciesNow[currencyISO[offer.cost[0].item]]),
                    updated: new Date(),
                    quest_unlock: Boolean(offer.taskUnlock) !== false,
                    quest_unlock_id: offer.taskUnlock,
                    currency: currencyISO[offer.cost[0].item],
                    currencyItem: offer.cost[0].item,
                    requirements: [{
                        type: 'loyaltyLevel',
                        value: offer.minLevel,
                    }],
                    traderOfferId: offer.id,
                };    
                if (offer.taskUnlock) {
                    newOffer.requirements.push({
                        type: 'questCompleted',
                        stringValue: offer.taskUnlock,
                    });
                }   
                if (!outputData[itemId]) {
                    outputData[itemId] = [];
                }
                outputData[itemId].push(newOffer);
                this.logger.log(`Added ${newOffer.item_name} for ${trader.normalizedName} LL${newOffer.vendor.minTraderLevel}`);
            });
        }

        return this.outputPrices(outputData);
    }

    outputPrices = async (prices) => {
        const priceData = {
            TraderCashOffer: prices,
        };
        await this.cloudflarePut(priceData);
        return priceData;
    }

    getQuestUnlock = (traderItem) => {
        if (!isNaN(parseInt(traderItem.quest_unlock_id)) || traderItem.quest_unlock_bsg_id) {
            const trader = this.getTraderByName(traderItem.trader_name);
            const itemId = traderItem.item_id;
            for (const quest of this.tasks) {
                const match = unlockMatches(itemId, quest.startRewards, trader._id) || unlockMatches(itemId, quest.finishRewards, trader._id);
                if (match) {
                    return {
                        id: quest.id,
                        tarkovDataId: quest.tarkovDataId,
                        level: match.level
                    };
                }
            }
            throw new Error(`Could not find quest unlock for trader offer ${traderItem.id}: ${traderItem.trader_name} ${this.items.get(traderItem.item_id).name} ${traderItem.item_id}`);
        }
        return false;
    }

    getTraderByName = (traderName) => {
        return Object.values(this.traders).find(t => {
            const normalized = this.normalizeName(this.localeEn[`${t._id} Nickname`]);
            return normalized === traderName.toLowerCase();
        });
    }
}

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

const unlockMatches = (itemId, rewards, traderId) => {
    if (!rewards || !rewards.offerUnlock) return false;
    for (const unlock of rewards.offerUnlock) {
        if (unlock.trader_id !== traderId) continue;
        if (unlock.item === itemId) return unlock;
        if (unlock.base_item_id && unlock.base_item_id === itemId) return unlock;
    }
    return false;
};

export default UpdateTraderPricesJob;
