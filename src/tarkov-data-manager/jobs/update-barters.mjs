import tarkovData from '../modules/tarkov-data.mjs';
import remoteData from '../modules/remote-data.mjs';
import DataJob from '../modules/data-job.mjs';

const skipOffers = {
    jaeger: {
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
    peacekeeper: {
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
    }
};

class UpdateBartersJob extends DataJob {
    constructor() {
        super('update-barters');
        this.kvName = 'barter_data';
    }

    async run() {
        [this.tasks, this.traders, this.traderAssorts, this.itemData, this.items, this.en] = await Promise.all([
            this.jobManager.jobOutput('update-quests', this),
            this.jobManager.jobOutput('update-traders', this),
            this.jobManager.jobOutput('update-trader-assorts', this, true),
            remoteData.get(),
            tarkovData.items(),
            tarkovData.locale('en'),
        ]);
        this.dogtags = [
            '59f32bb586f774757e1e8442',
            '59f32c3b86f77472a31742f0',
            'customdogtags12345678910',
        ];
        this.barters = [];
        const lastOfferScan = await this.query(`
            SELECT 
                * 
            FROM 
                trader_offer_scan 
            WHERE 
                ended IS NOT NULL 
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
        `, [lastOfferScan.started]);
        this.offerRequirements = await this.query(`SELECT * FROM trader_offer_requirements`);
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
            const trader = this.traders.find(t => t.id === offer.trader_id);
            const questUnlock = this.getQuestUnlock(offer);
            const assort = this.traderAssorts[trader.id]?.find(assort => assort.id === offer.id);
            const barter = {
                id: offer.id,
                trader_id: trader.id,
                trader_name: this.en[trader.name],
                trader: `${this.en[trader.name]} LL${offer.min_level}`,
                source: `${this.en[trader.name]} LL${offer.min_level}`,
                sourceName: trader.normalizedName,
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
            this.barters.push(barter);
        }

        let ammoPacks = 0;
        for (const barter of this.barters) {
            const rewardItem = this.itemData.get(barter.rewardItems[0].item);
            if (!rewardItem.types.includes('ammo-box')) {
                continue;
            }
            const ammoContents = this.items[rewardItem.id]._props.StackSlots[0];
            const count = ammoContents._max_count;
            const roundId = ammoContents._props.filters[0].Filter[0];
            this.barters.push({
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

        this.logger.log(`Unpacked ${ammoPacks} ammo pack barters`);

        await this.cloudflarePut({Barter: this.barters});
        return this.barters;
    }

    getQuestUnlock = (offer) => {
        if (!offer.locked) {
            return null;
        }
        const trader = this.traders.find(t => t.id === offer.trader_id);
        const itemId = offer.item_id;
        for (const quest of this.tasks) {
            const match = unlockMatches(itemId, quest.startRewards, trader.id) || unlockMatches(itemId, quest.finishRewards, trader.id);
            if (match) {
                return {
                    id: quest.id,
                    tarkovDataId: quest.tarkovDataId,
                    level: match.level
                };
            }
        }
        this.logger.warn(`Could not find quest unlock for trader offer ${offer.id}: ${trader.normalizedName} ${offer.min_level} ${this.itemData.get(itemId).name} ${itemId}`);
        return null;
    }

    skipOffer = (offer, requirements) => {
        const trader = this.traders.find(t => t.id === offer.trader_id);
        if (!skipOffers[trader.normalizedName]) {
            return false;
        }
        if (!skipOffers[trader.normalizedName][offer.min_level]) {
            return false;
        }
        const rewardOffers = skipOffers[trader.normalizedName][offer.min_level].filter(o => o.reward === offer.item_id);
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
