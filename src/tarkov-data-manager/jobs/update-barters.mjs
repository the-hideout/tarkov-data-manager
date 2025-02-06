import tarkovData from '../modules/tarkov-data.mjs';
import remoteData from '../modules/remote-data.mjs';
import DataJob from '../modules/data-job.mjs';

const skipOffers = {
    '5c0647fdd443bc2504c2d371': { // jaeger
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
    '5935c25fb3acc3127c3d8cd9': { // peacekeeper
        1: [
            {
                reward: '5c110624d174af029e69734c', // T-7 Thermal Goggles with a Night Vision mount
                requirements: [
                    '5c0530ee86f774697952d952', // LEDX Skin Transilluminator
                    '6389c85357baa773a825b356', // Far-forward current converter
                    '6389c8c5dbfd5e4b95197e6b', // TerraGroup \"Blue Folders\" materials
                ],
            }
        ]
    },
    '54cb50c76803fa8b248b4571': { // prapor
        4: [
            {
                reward: '5c1260dc86f7746b106e8748', // 9x39mm BP gs ammo pack (8 pcs)
                requirements: [
                    '5734770f24597738025ee254' // strike cigarettes
                ]
            }
        ]
    },
    '5ac3b934156ae10c4430e83c': { // ragman
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
        ]
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
            }
        ]
    }
};

class UpdateBartersJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-barters'});
        this.kvName = 'barter_data';
    }

    async run() {
        [this.traderAssorts, this.itemData, this.items, this.en, this.offerRequirements] = await Promise.all([
            this.jobOutput('update-trader-assorts', {rawOutput: true}),
            remoteData.get(),
            tarkovData.items(),
            tarkovData.locale('en'),
            this.query(`SELECT * FROM trader_offer_requirements`),
        ]);
        this.dogtags = [
            '59f32bb586f774757e1e8442',
            '59f32c3b86f77472a31742f0',
            'customdogtags12345678910',
        ];
        for (const gameMode of this.gameModes) {
            [this.tasks, this.traders ] = await Promise.all([
                this.jobOutput('update-quests', {gameMode: gameMode.name}),
                tarkovData.traders({gameMode: gameMode.name}),
            ]);
            this.questsUsedForUnlocks = {};
            this.kvData[gameMode.name] = { Barter: [] };
            const barters = this.kvData[gameMode.name].Barter;
            const lastOfferScan = await this.query(`
                SELECT 
                    * 
                FROM 
                    trader_offer_scan 
                WHERE 
                    ended IS NOT NULL 
                AND
                    game_mode = ?
                ORDER BY 
                    id DESC LIMIT 1
            `, [gameMode.value]).then(result => {
                if (result.length === 0) {
                    return false;
                }
                return result[0];
            });
            if (!lastOfferScan) {
                this.logger.warn(`No completed ${gameMode.name} trader scans`);
                continue;
            }
            const offers = await this.query(`
                SELECT 
                    *
                FROM 
                    trader_offers 
                WHERE 
                    last_scan >= ?
                AND
                    game_mode = ?
            `, [lastOfferScan.started, gameMode.value]);
            for (const offer of offers) {
                if (offer.price) {
                    continue;
                }
                const item = this.itemData.get(offer.item_id);
                if (item.types.includes('disabled')) {
                    this.logger.warn(`Skipping disabled item ${item.name} ${item.id}`);
                    continue;
                }
                const requirements = this.offerRequirements.filter(req => req.offer_id === offer.id).filter(req => {
                    const reqItem = this.itemData.get(req.requirement_item_id);
                    if (!reqItem) {
                        this.logger.warn(`Skipping requirement unknown item ${req.requirement_item_id}`);
                        return false;
                    }
                    if (reqItem.types.includes('disabled')) {
                        this.logger.warn(`Skipping requirement disabled item ${reqItem.name} ${reqItem.id}`);
                        return false;
                    }
                    return true;
                });
                if (this.skipOffer(offer, requirements.map(r => r.requirement_item_id))) {
                    continue;
                }
                const traderName = this.en[`${offer.trader_id} Nickname`];
                const questUnlock = this.getQuestUnlock(offer);
                const assort = this.traderAssorts[offer.trader_id]?.find(assort => assort.id === offer.id);
                const barter = {
                    id: offer.id,
                    trader_id: offer.trader_id,
                    trader_name: traderName,
                    trader: `${traderName} LL${offer.min_level}`,
                    source: `${traderName} LL${offer.min_level}`,
                    sourceName: this.normalizeName(traderName),
                    level: offer.min_level,
                    taskUnlock: questUnlock ? questUnlock.id : null,
                    rewardItems: [
                        {
                            name: item.name,
                            item: offer.item_id,
                            count: 1,
                            attributes: [],
                        }
                    ],
                    requiredItems: [],
                    requirements: [
                        {
                            type: 'loyaltyLevel',
                            value: offer.min_level,
                        }
                    ],
                    restockAmount: assort ? assort.stock : offer.restock_amount,
                    buyLimit: offer.buy_limit,
                };
                if (questUnlock) {
                    barter.requirements.push({
                        type: 'questCompleted',
                        value: questUnlock.tarkovDataId,
                        stringValue: questUnlock.id,
                    });
                }
                for (const req of requirements) {
                    const atts = [];
                    if (this.dogtags.includes(req.requirement_item_id)) {
                        atts.push({
                            type: 'minLevel',
                            value: req.properties.level,
                        });
                    }
                    barter.requiredItems.push({
                        name: this.itemData.get(req.requirement_item_id).name,
                        item: req.requirement_item_id,
                        count: req.count,
                        attributes: atts,
                    });
                }
                barters.push(barter);
            }
    
            let ammoPacks = 0;
            for (const barter of barters) {
                const rewardItem = this.itemData.get(barter.rewardItems[0].item);
                if (!rewardItem.types.includes('ammo-box')) {
                    continue;
                }
                const ammoContents = this.items[rewardItem.id]._props.StackSlots[0];
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

            let kvName = this.kvName;
            if (gameMode.name !== 'regular') {
                kvName += `_${gameMode.name}`;
            }
    
            await this.cloudflarePut(this.kvData[gameMode.name], kvName);
        }

        return this.kvData;
    }

    getQuestUnlock = (offer) => {
        if (!offer.locked) {
            return null;
        }
        const itemId = offer.item_id;
        for (const quest of this.tasks) {
            const match = unlockMatches(itemId, quest.startRewards, offer.trader_id) || unlockMatches(itemId, quest.finishRewards, offer.trader_id);
            if (this.questsUsedForUnlocks[offer.trader_id]?.[match.level]?.[itemId]?.includes(quest.id)) {
                continue;
            }
            if (match) {
                this.questsUsedForUnlocks[offer.trader_id] ??= {};
                this.questsUsedForUnlocks[offer.trader_id][match.level] ??= {};
                this.questsUsedForUnlocks[offer.trader_id][match.level][itemId] ??= [];
                this.questsUsedForUnlocks[offer.trader_id][match.level][itemId].push(quest.id);
                return {
                    id: quest.id,
                    tarkovDataId: quest.tarkovDataId,
                    level: match.level
                };
            }
        }
        this.logger.warn(`Could not find quest unlock for trader offer ${offer.id}: ${this.en[`${offer.trader_id} Nickname`]} ${offer.min_level} ${this.itemData.get(itemId).name} ${itemId}`);
        return null;
    }

    skipOffer = (offer, requirements) => {
        if (!skipOffers[offer.trader_id]) {
            return false;
        }
        if (!skipOffers[offer.trader_id][offer.min_level]) {
            return false;
        }
        const rewardOffers = skipOffers[offer.trader_id][offer.min_level].filter(o => o.reward === offer.item_id);
        if (rewardOffers.length === 0) {
            return false;
        }
        if (!rewardOffers.some(o => o.requirements.every(id => requirements.includes(id)))) {
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

export default UpdateBartersJob;
