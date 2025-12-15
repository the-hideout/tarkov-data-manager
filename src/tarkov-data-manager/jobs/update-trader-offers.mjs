// updates trader barters and cash offers

import DataJob from '../modules/data-job.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import remoteData from '../modules/remote-data.mjs';
import spApi from '../modules/sp-data.mjs';
import presetData from '../modules/preset-data.mjs';
import dogtags from '../modules/dogtags.mjs';

const skipOffers = {
    '5c0647fdd443bc2504c2d371': { // jaeger
        1: [
            {
                reward: '59e0d99486f7744a32234762', // Bloodhounds
            }
        ],
        4: [
            {
                reward: '5c110624d174af029e69734c', // T-7 Thermal Goggles with a Night Vision mount
                requirements: [
                    '5fc64ea372b0dd78d51159dc', // Cultist knife
                ],
            },
            {
                reward: '5fca138c2a7b221b2852a5c6', // xTG-12 antidote injector
                requirements: [
                    '6389c6c7dbfd5e4b95197e68' // Aquapeps water purification tablets
                ],
            }
        ],
    },
    '5a7c2eca46aef81a7ca2145d': { //mechanic
        1: [
            {
                reward: '5656eb674bdc2d35148b457c', // Failed Setup
            },
            {
                reward: '62e7e7bbe6da9612f743f1e0', // Failed Setup
            },
            {
                reward: '6357c98711fb55120211f7e1', // Failed Setup
            },
            {
                reward: '5ede475b549eed7c6d5c18fb', // Failed Setup
            },
        ],
        3: [
            {
                reward: '5b07db875acfc40dc528a5f6', // AR-15 Tactical Dynamics Skeletonized pistol grip
            }
        ],
    },
    '5935c25fb3acc3127c3d8cd9': { // peacekeeper
        1: [
            {
                reward: '601aa3d2b2bcb34913271e6d', // 7.62x39mm MAI AP
            },
            {
                reward: '5c110624d174af029e69734c', // T-7 Thermal Goggles with a Night Vision mount
                requirements: [
                    '5c0530ee86f774697952d952', // LEDX Skin Transilluminator
                    '6389c85357baa773a825b356', // Far-forward current converter
                    '6389c8c5dbfd5e4b95197e6b', // TerraGroup \"Blue Folders\" materials
                ],
            },
        ],
    },
    '54cb50c76803fa8b248b4571': { // prapor
        4: [
            {
                reward: '5c1260dc86f7746b106e8748', // 9x39mm BP gs ammo pack (8 pcs)
                requirements: [
                    '5734770f24597738025ee254' // strike cigarettes
                ]
            },
        ],
    },
    '5ac3b934156ae10c4430e83c': { // ragman
        1: [
            {
                reward: '679b9819a2f2dd4da9023512', // Labrys access keycard
                requirements: [
                    '5734758f24597738025ee253', // Golden neck chain
                    '5c12688486f77426843c7d32', // Paracord
                    '61bf83814088ec1a363d7097', // Sewing kit
                    '59e3556c86f7741776641ac2', // Ox Bleach
                ],
            }
        ],
        4: [
            {
                reward: '5f60c74e3b85f6263c145586', // Rys-T bulletproof helmet (Black)
                requirements: [
                    '5e2af4d286f7746d4159f07a', // Aramid
                    '61bf83814088ec1a363d7097', // Sewing kit
                    '62a0a098de7ac8199358053b', // awl
                ]
            },
            {
                reward: '65766910303700411c0242da', // IOTV Gen4 body armor (Full Protection Kit, MultiCam) Default
                requirements: [
                    '59e3647686f774176a362507', // Wooden clock
                ]
            },
        ],
    },
    '58330581ace78e27b8b10cee': { // skier
        1: [
            {
                reward: '54491c4f4bdc2db1078b4568', // skier doesn't sell mp-133
            },
            {
                reward: '5efb0da7a29a85116f6ea05f', // Hint
            },
            {
                reward: '5b2388675acfc4771e1be0be', // Burris Fullfield - Cocktail Tasting
                requirements: [
                    '5d1b2ffd86f77425243e8d17',
                ],
            },
            {
                reward:  '618ba27d9008e4636a67f61d', // Vortex Razor - Cocktail Tasting
                requirements: [
                    '573474f924597738002c6174',
                    '5734758f24597738025ee253',
                ],
            },
            {
                reward: '5b3b99475acfc432ff4dcbee', // Cocktail Tasting
            },
        ],
    },
    '54cb57776803fa99248b456e' : { // therapist
        1: [
            { // from A Key to Salvation
                reward: '635267f063651329f75a4ee8', // 26x75mm flare cartridge (Acid Green)
                requirements: [
                    '59e361e886f774176c10a2a5', // hydrogen peroxide
                    '62a0a043cf4a99369e2624a5', // multivitamins
                    '5c052e6986f7746b207bc3c9', // defib
                ]
            },
            {
                reward: '544fb45d4bdc2dee738b4568' // Salewa
            }
        ],
    },
};

class UpdateTraderOffersJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-trader-offers'});
        this.writeFolder = 'cache';
        this.kvName = 'trader_price_data';
    }

    async run() {
        this.currencyData = {
            '5449016a4bdc2d6f028b456f': {
                code: 'RUB',
                value: 1,
            },
            '5696686a4bdc2da3298b456a': {
                code: 'USD',
            },
            '569668774bdc2da2298b4568': {
                code: 'EUR',
            },
        };
        [this.traderAssorts, this.items, this.credits] = await Promise.all([
            this.jobManager.jobOutput('update-trader-assorts', this, 'regular', true),
            remoteData.get(),
        ]);
        const cashOfferData = {};
        const barterData = {};
        for (const gameMode of this.gameModes) {
            const cashOffers = {};
            const barters = [];
            cashOfferData[gameMode.name] = {
                TraderCashOffer: cashOffers,
            };
            barterData[gameMode.name] = {
                Barter: barters,
            };
            [
                this.bsgItems,
                this.traders,
                this.credits,
                this.en,
                this.traderOffers,
                this.tasks,
            ] = await Promise.all([
                tarkovData.items({gameMode: gameMode.name}),
                tarkovData.traders({gameMode: gameMode.name}),
                tarkovData.credits({gameMode: gameMode.name}),
                tarkovData.locale('en', {gameMode: gameMode.name}),
                spApi.traderPrices(gameMode.name),
                this.jobManager.jobOutput('update-quests', this, gameMode.name),
            ]);
            //this.offerRequirements = await this.query(`SELECT * FROM trader_offer_requirements`);
            this.getCurrencyValues(this.traderOffers.data);
            for (const offer of this.traderOffers.data) {
                if (this.skipOffer(offer)) {
                    continue;
                }
                if (!this.traders.find(t => t._id === offer.user.id)) {
                    this.logger.warn(`Unknown trader ${offer.user.id} for offer ${offer._id}`);
                    continue;
                }
                let item = this.items.get(offer.items[0]._tpl);
                if (!item) {
                    this.logger.warn(`Skipping missing item ${offer.items[0]._tpl} in offer ${offer._id}`);
                    continue;
                }
                if (item.types.includes('disabled')) {
                    this.logger.warn(`Skipping disabled item ${item.name} ${item.id} in offer ${offer._id}`);
                    continue;
                }
                let questUnlock = null;
                try {
                    questUnlock = this.getQuestUnlock(offer);
                } catch (error) {
                    if (error.code === 'UNKNOWN_QUEST_UNLOCK') {
                        this.logger.warn(`Unknown quest unlock for trader offer ${offer._id}: ${error.trader} ${offer.loyaltyLevel} ${error.item} ${offer.items[0]._tpl}`);
                    } else {
                        this.logger.error(`Error checking quest unlock: ${error.message}`);
                    }
                }
                offer.items = offer.items.filter(offerItem => {
                    const bsgItem = this.bsgItems[offerItem._tpl];
                    if (!bsgItem) {
                        return false;
                    }
                    return bsgItem._parent !== '65649eb40bf0ed77b8044453'; // no soft armor inserts
                });
                if (offer.items.length > 1 && !item.types.includes('ammo-box')) {
                    let preset = presetData.findPreset(offer.items);
                    if (!preset) {
                        preset = await presetData.addJsonPreset(offer, this.logger);
                    }
                    item = {id: preset.id};
                }
                const traderName = this.en[`${offer.user.id} Nickname`];
                const assort = this.traderAssorts[offer.trader_id]?.find(assort => assort.id === offer._id);
                if (this.isCashOffer(offer)) {
                    // cash offer
                    const currency = this.currencyData[offer.requirements[0]._tpl];
                    const cashPrice = {
                        offer_id: offer._id,
                        id: item.id,
                        item_name: item.name,
                        vendor: {
                            trader: offer.user.id,
                            trader_id: offer.user.id,
                            traderLevel: offer.loyaltyLevel,
                            minTraderLevel: offer.loyaltyLevel,
                            taskUnlock: questUnlock?.id,
                            restockAmount: assort?.stock ?? offer.quantity,
                            buyLimit: parseInt(offer.buyRestrictionMax) ?? 0,
                        },
                        source: this.normalizeName(traderName),
                        price: Math.round(offer.requirements[0].count), // prices in API are Int; we should convert to float
                        priceRUB: Math.round(offer.requirements[0].count * currency.value),
                        updated: offer.updated,
                        quest_unlock: Boolean(questUnlock),
                        quest_unlock_id: questUnlock ? questUnlock.id : null,
                        currency: currency.code,
                        currencyItem: offer.requirements[0]._tpl,
                        requirements: [
                            {
                                type: 'loyaltyLevel',
                                value: offer.loyaltyLevel,
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
                    if (!cashOffers[item.id]) {
                        cashOffers[item.id] = [];
                    }
                    cashOffers[item.id].push(cashPrice);
                } else {
                    const barter = {
                        id: offer._id,
                        trader_id: offer.user.id,
                        trader_name: traderName,
                        trader: `${traderName} LL${offer.loyaltyLevel}`,
                        source: `${traderName} LL${offer.loyaltyLevel}`,
                        sourceName: this.normalizeName(traderName),
                        level: offer.loyaltyLevel,
                        taskUnlock: questUnlock ? questUnlock.id : null,
                        rewardItems: [
                            {
                                name: item.name,
                                item: item.id,
                                count: 1,
                                attributes: [],
                            }
                        ],
                        requiredItems: [],
                        requirements: [
                            {
                                type: 'loyaltyLevel',
                                value: offer.loyaltyLevel,
                            }
                        ],
                        restockAmount: assort?.stock ?? offer.quantity,
                        buyLimit: parseInt(offer.buyRestrictionMax) ?? 0,
                    };
                    if (questUnlock) {
                        barter.requirements.push({
                            type: 'questCompleted',
                            value: questUnlock.tarkovDataId,
                            stringValue: questUnlock.id,
                        });
                    }
                    for (const req of offer.requirements) {
                        let reqItem = this.items.get(req._tpl);
                        if (!reqItem) {
                            this.logger.warn(`Skipping unknown required item ${req._tpl}`);
                            continue;
                        }
                        if (reqItem.types.includes('disabled')) {
                            this.logger.warn(`Skipping disabled required item ${reqItem.name} ${reqItem.id}`);
                            continue;
                        }
                        const atts = [];
                        if (req.type === 'DogtagRequirement') {
                            atts.push({
                                type: 'minLevel',
                                value: req.level,
                            });
                            if (req.side === 'Any') {
                                reqItem = this.items.get(dogtags.ids.any);
                            }
                        }
                        barter.requiredItems.push({
                            name: reqItem.name,
                            item: reqItem.id,
                            count: req.count,
                            attributes: atts,
                        });
                    }
                    if (barter.requiredItems.length < 1) {
                        this.logger.warn(`No valid requirements for barter ${offer._id}`);
                        continue;
                    }
                    barters.push(barter);
                }
            }

            let ammoPacks = 0;
            for (const barter of barters) {
                const rewardItem = this.items.get(barter.rewardItems[0].item);
                if (!rewardItem.types.includes('ammo-box')) {
                    continue;
                }
                const ammoContents = this.bsgItems[rewardItem.id]._props.StackSlots[0];
                const count = ammoContents._max_count;
                const roundId = ammoContents._props.filters[0].Filter[0];
                barters.push({
                    ...barter,
                    id: `${barter.id}-${roundId}`,
                    rewardItems: [{
                        name: rewardItem.name,
                        item: roundId,
                        baseId: roundId,
                        count: count,
                        attributes: []
                    }],
                });
                ammoPacks++;
            }
            this.logger.log(`Unpacked ${ammoPacks} ${gameMode.name} ammo pack barters`);

            let kvSuffix = '';
            if (gameMode.name !== 'regular') {
                kvSuffix = `_${gameMode.name}`;
            }
            await this.cloudflarePut(cashOfferData[gameMode.name], `trader_price_data${kvSuffix}`);
            await this.cloudflarePut(barterData[gameMode.name], `barter_data${kvSuffix}`);
        }
        return {...cashOfferData, ...barterData};
    }

    getCurrencyValues = (offers) => {
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
            const offer = offers.find(o => o.items[0]._tpl === itemId && o.requirements[0]._tpl === '5449016a4bdc2d6f028b456f');
            if (offer) {
                price = offer.requirements[0].count;
            } else {
                this.logger.warn(`Could not find trader price for currency ${currencyCode}`);
            }
            this.currencyData[itemId].value = price;
        }
    };

    getQuestUnlock = (offer) => {
        if (typeof offer.locked === 'undefined') {
            return null;
        }
        const itemId = offer.items[0]._tpl;
        for (const quest of this.tasks) {
            const match = unlockMatches(offer, quest.startRewards) || unlockMatches(offer, quest.finishRewards);
            if (match) {
                return {
                    id: quest.id,
                    tarkovDataId: quest.tarkovDataId,
                    level: match.level
                };
            }
        }
        const traderNormalizedName = this.normalizeName(this.en[`${offer.user.id} Nickname`]);
        const error = new Error(`Unknown quest unlock for trader offer ${offer._id}: ${traderNormalizedName} ${offer.loyaltyLevel} ${this.items.get(itemId).name} ${itemId}`);
        error.code = 'UNKNOWN_QUEST_UNLOCK';
        error.trader = traderNormalizedName;
        error.item = this.items.get(itemId).name;
        //this.logger.warn(`Could not find quest unlock for trader offer ${offer.id}: ${traderNormalizedName} ${offer.min_level} ${this.items.get(itemId).name} ${itemId}`);
        throw error;
    }

    isCashOffer = (offer) => {
        return offer.requirements.length === 1 && Object.keys(this.currencyData).includes(offer.requirements[0]._tpl);
    }

    skipOffer = (offer) => {
        const traderLevelSkips = skipOffers[offer.user.id]?.[offer.loyaltyLevel];
        if (!traderLevelSkips) {
            return false;
        }
        const isCashOffer = this.isCashOffer(offer);
        if (isCashOffer && traderLevelSkips.some(skip => skip.reward === offer.items[0]._tpl && !skip.requirements)) {
            return true;
        }
        if (!isCashOffer && traderLevelSkips.some(skip => skip.reward === offer.items[0]._tpl && skip.requirements?.length === offer.requirements.length && offer.requirements.every(r => skip.requirements.includes(r._tpl)))) {
            return true;
        }
        return false;
    }
}

const unlockMatches = (offer, rewards) => {
    if (!rewards || !rewards.offerUnlock) return false;
    for (const unlock of rewards.offerUnlock) {
        if (unlock.trader_id !== offer.user.id) continue;
        if (unlock.level !== offer.loyaltyLevel) continue;
        if (unlock.item === offer.items[0]._tpl) return unlock;
        if (unlock.base_item_id && unlock.base_item_id === offer.items[0]._tpl) return unlock;
    }
    return false;
};

export default UpdateTraderOffersJob;
