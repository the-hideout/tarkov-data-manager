import DataJob from '../modules/data-job.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import remoteData from '../modules/remote-data.mjs';

const skipOffers = {
    '5c0647fdd443bc2504c2d371': { // jaeger
        1: [
            '59e0d99486f7744a32234762', // Bloodhounds
        ],
    },
    '5a7c2eca46aef81a7ca2145d': { //mechanic
        1: [
            '5656eb674bdc2d35148b457c', // Failed Setup
            '62e7e7bbe6da9612f743f1e0', // Failed Setup
            '6357c98711fb55120211f7e1', // Failed Setup
            '5ede475b549eed7c6d5c18fb', // Failed Setup
        ],
        3: [
            '5b07db875acfc40dc528a5f6' // AR-15 Tactical Dynamics Skeletonized pistol grip
        ],
    },
    '5935c25fb3acc3127c3d8cd9': { // peacekeeper
        1: [
            '601aa3d2b2bcb34913271e6d' // 7.62x39mm MAI AP
        ]
    },
    '58330581ace78e27b8b10cee': { // skier
        1: [
            '584148f2245977598f1ad387', // skier doesn't sell mp-133
            '5efb0da7a29a85116f6ea05f', // Hint
            '5b2388675acfc4771e1be0be', // Cocktail Tasting
            '618ba27d9008e4636a67f61d', // Cocktail Tasting
            '5b3b99475acfc432ff4dcbee', // Cocktail Tasting
        ],
    },
};

class UpdateTraderPricesJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-trader-prices'});
        this.writeFolder = 'cache';
        this.kvName = 'trader_price_data';
    }

    async run() {
        this.currencyId = {
            'RUB': '5449016a4bdc2d6f028b456f',
            'USD': '5696686a4bdc2da3298b456a',
            'EUR': '569668774bdc2da2298b4568'
        };
        [this.tasks, this.traders, this.traderAssorts, this.items, this.credits, this.en] = await Promise.all([
            this.jobManager.jobOutput('update-quests', this),
            tarkovData.traders(),
            this.jobManager.jobOutput('update-trader-assorts', this, true),
            remoteData.get(),
            tarkovData.credits(),
            tarkovData.locale('en'),
        ]);
        this.cashOffers = {};
        const lastOfferScan = await this.query(`
            SELECT 
                * 
            FROM 
                trader_offer_scan 
            WHERE 
                ended IS NOT NULL 
            AND
                game_mode = 0
            ORDER BY 
                id DESC LIMIT 1
        `).then(result => {
            if (result.length === 0) {
                return Promise.reject('No completed trader scans');
            }
            return result[0];
        });
        const offers = await this.query(`
            SELECT 
                *
            FROM 
                trader_offers 
            WHERE 
                last_scan >= ?
            AND
                game_mode = 0
        `, [lastOfferScan.started]);
        this.offerRequirements = await this.query(`SELECT * FROM trader_offer_requirements`);
        this.getCurrencyValues(offers);
        for (const offer of offers) {
            if (!offer.price) {
                continue;
            }
            if (this.skipOffer(offer)) {
                continue;
            }
            if (!this.traders[offer.trader_id]) {
                continue;
            }
            const item = this.items.get(offer.item_id);
            if (item.types.includes('disabled')) {
                this.logger.warn(`Skipping disabled item ${item.name} ${item.id}`);
                continue;
            }
            let questUnlock = null;
            try {
                questUnlock = this.getQuestUnlock(offer);
            } catch (error) {
                if (error.code === 'UNKNOWN_QUEST_UNLOCK') {
                    if (offer.min_level === 1) {
                        this.logger.warn(`Unknown quest unlock for (excluded) trader offer ${offer.id}: ${error.trader} ${offer.min_level} ${error.item} ${offer.item_id}`);
                        continue;
                    } else {
                        this.logger.warn(`Unknown quest unlock for trader offer ${offer.id}: ${error.trader} ${offer.min_level} ${error.item} ${offer.item_id}`);
                    }
                } else {
                    this.logger.error(`Error checking quest unlock: ${error.message}`);
                }
            }
            const assort = this.traderAssorts[offer.trader_id].find(assort => assort.id === offer.id);
            const cashPrice = {
                id: offer.item_id,
                item_name: item.name,
                vendor: {
                    traderOfferId: offer.id,
                    trader: offer.trader_id,
                    trader_id: offer.trader_id,
                    traderLevel: offer.min_level,
                    minTraderLevel: offer.min_level,
                    taskUnlock: questUnlock?.id,
                    restockAmount: assort ? assort.stock : offer.restock_amount,
                    buyLimit: offer.buy_limit,
                },
                source: this.normalizeName(this.en[`${offer.trader_id} Nickname`]),
                price: Math.round(offer.price), // prices in API are Int; we should convert to float
                priceRUB: Math.round(offer.price * this.currencyValues[offer.currency]),
                updated: offer.updated,
                quest_unlock: Boolean(questUnlock),
                quest_unlock_id: questUnlock ? questUnlock.id : null,
                currency: offer.currency,
                currencyItem: this.currencyId[offer.currency],
                requirements: [
                    {
                        type: 'loyaltyLevel',
                        value: offer.min_level,
                    }
                ],
            };
            if (questUnlock) {
                cashPrice.requirements.push({
                    type: 'questCompleted',
                    value: questUnlock.tarkovDataId,
                    stringValue: questUnlock.id,
                });
            }
            if (!this.cashOffers[offer.item_id]) {
                this.cashOffers[offer.item_id] = [];
            }
            this.cashOffers[offer.item_id].push(cashPrice);
        }
        const priceData = {
            TraderCashOffer: this.cashOffers,
        };
        await this.cloudflarePut(priceData);
        return priceData;
    }

    getCurrencyValues = (offers) => {
        this.currencyValues = {
            RUB: 1,
        }
        const currencies = {
            USD: {
                id: '5696686a4bdc2da3298b456a',
                multiplier: 1.104271357,
            },
            EUR: {
                id: '569668774bdc2da2298b4568',
                multiplier: 1.152974504,
            }
        };
        for (const currencyCode in currencies) {
            const itemId = currencies[currencyCode].id;
            let price = Math.round(this.credits[itemId] * currencies[currencyCode].multiplier)
            const offer = offers.find(o => o.item_id === itemId);
            if (offer) {
                price = offer.price;
            } else {
                this.logger.warn(`Could not find trader price for currency ${currencyCode}`);
            }
            this.currencyValues[currencyCode] = price;
        }
    };

    getQuestUnlock = (offer) => {
        if (!offer.locked) {
            return null;
        }
        const itemId = offer.item_id;
        for (const quest of this.tasks) {
            const match = unlockMatches(itemId, quest.startRewards, offer.trader_id) || unlockMatches(itemId, quest.finishRewards, offer.trader_id);
            if (match) {
                return {
                    id: quest.id,
                    tarkovDataId: quest.tarkovDataId,
                    level: match.level
                };
            }
        }
        const traderNormalizedName = this.normalizeName(this.en[`${offer.trader_id} Nickname`]);
        const error = new Error(`Unknown quest unlock for trader offer ${offer.id}: ${traderNormalizedName} ${offer.min_level} ${this.items.get(itemId).name} ${itemId}`);
        error.code = 'UNKNOWN_QUEST_UNLOCK';
        error.trader = traderNormalizedName;
        error.item = this.items.get(itemId).name;
        //this.logger.warn(`Could not find quest unlock for trader offer ${offer.id}: ${traderNormalizedName} ${offer.min_level} ${this.items.get(itemId).name} ${itemId}`);
        throw error;
    }

    getTraderByName = (traderName) => {
        for (const traderId in this.traders) {
            const normalized = this.normalizeName(this.en[`${traderId} Nickname`]);
            return normalized === traderName.toLowerCase();
        };
    }

    skipOffer = (offer) => {
        if (!skipOffers[offer.trader_id]) {
            return false;
        }
        if (!skipOffers[offer.trader_id][offer.min_level]) {
            return false;
        }
        if (!skipOffers[offer.trader_id][offer.min_level].includes(offer.item_id)) {
            return false;
        }
        return true;
    }
}

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
