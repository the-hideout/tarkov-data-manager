import fs from 'fs';
import path from 'path';

import DataJob from '../modules/data-job.mjs';
import remoteData from '../modules/remote-data.mjs';
import tarkovData from '../modules/tarkov-data.mjs';

class UpdateTraderAssortsJob extends DataJob {
    constructor() {
        super('update-trader-assorts');
        this.writeFolder = 'cache';
        this.kvName = 'trader_assorts';
    }

    async run() {
        [this.tasks, this.traders, this.presets, this.items, this.en] = await Promise.all([
            this.jobManager.jobOutput('update-quests', this),
            this.jobManager.jobOutput('update-traders', this),
            this.jobManager.jobOutput('update-presets', this),
            remoteData.get(),
            tarkovData.locale('en'),
        ]);
        this.currencyId = {
            'RUB': '5449016a4bdc2d6f028b456f',
            'USD': '5696686a4bdc2da3298b456a',
            'EUR': '569668774bdc2da2298b4568'
        };
        const assorts = {};
        const traderAssortPromises = [];
        for (const trader of this.traders) {
            const traderId = trader.id;
            traderAssortPromises.push(Promise.all([
                tarkovData.traderAssorts(traderId, true).catch(error => {
                    this.logger.error(`Error downloading assorts: ${error.message}`);
                    return tarkovData.traderAssorts(traderId, false);
                }).then(assorts => {
                    assorts.items = assorts.items.reduce((items, item) => {
                        if (item.parentId === 'hideout') {
                            items.push({
                                _id: item._id,
                                _items: [
                                    {
                                        _id: item._id,
                                        _tpl: item._tpl,
                                        upd: item.upd,
                                    }
                                ],
                            });
                        } else {
                            const parentItem = items.find(i => i._items.some(ii => ii._id === item.parentId));
                            //console.log(item.parentId, parentItem);
                            parentItem._items.push(item);
                        }
                        return items;
                    }, []);
                    return assorts;
                }),
                tarkovData.traderQuestAssorts(traderId, true).catch(error => {
                    this.logger.error(`Error downloading quest assorts: ${error.message}`);
                    return tarkovData.traderQuestAssorts(traderId, false);
                }).then(questAssort => {
                    return Object.keys(questAssort).reduce((allUnlocks, questStatus) => {
                        for (const assortId of Object.keys(questAssort[questStatus])) {
                            allUnlocks[assortId] = questAssort[questStatus][assortId];
                        }
                        return allUnlocks;
                    }, {});
                }),
                Promise.resolve(traderId),
            ]).then(([assort, questAssort, realTraderId]) => {
                assorts[realTraderId] = assort.items.map(offer => {
                    return {
                        id: offer._id,
                        item: offer._items[0]._tpl,
                        itemName: this.items.get(offer._items[0]._tpl).name,
                        baseItem: offer._items[0]._tpl,
                        stock: offer._items[0].upd.StackObjectsCount,
                        unlimitedStock: Boolean(offer._items[0].upd.UnlimitedCount),
                        buyLimit: offer._items[0].upd.BuyRestrictionMax || 0,
                        taskUnlock: questAssort[offer._id],
                        minLevel: assort.loyal_level_items[offer._id],
                        barter: false,
                        _items: offer._items,
                        contains: offer._items.reduce((contents, i) => {
                            const existingPart = contents.find(cont => cont.item === i._tpl);
                            if (existingPart) {
                                existingPart.count += i.upd?.StackObjectsCount || 1
                            } else {
                                contents.push({
                                    id: i._id,
                                    item: i._tpl,
                                    itemName: this.items.get(i._tpl).name,
                                    count: i.upd?.StackObjectsCount || 1,
                                });
                            }
                            return contents;
                        }, []),
                        cost: assort.barter_scheme[offer._id][0].map(req => {
                            let reqId = req._tpl;
                            if (req.side) {
                                reqId = dogTagSideMap[req.side];
                            }
                            return {
                                item: reqId,
                                itemName: this.items.get(reqId).name,
                                count: req.count,
                                dogTagLevel: req.level,
                                dogTagSide: req.side,
                            };
                        }),
                    };
                });
            }));
        };
        await Promise.all(traderAssortPromises);
        let totalOffers = 0;
        for (const traderId in assorts) {
            totalOffers += assorts[traderId].length;
            for (const offer of assorts[traderId]) {
                offer.barter = !this.isCashOffer(offer);
                const preset = this.offerMatchesPreset(offer);
                if (preset) {
                    offer.item = preset.id;
                    offer.itemName = preset.name;
                } else if (offer.contains.length > 1) {
                    //this.logger.warn('Could not match preset for offer');
                    //this.logger.log(JSON.stringify(offer, null, 4));
                }
            }
        }
        if (totalOffers === 0) {
            return Promise.reject(new Error('No trader offers found'));
        }
        for (const traderId in assorts) {
            const trader = this.traders.find(t => t.id === traderId);
            this.logger.log(`✔️ ${this.en[trader.name]}: ${assorts[traderId].length} offers`);
        }
        fs.writeFileSync(path.join(import.meta.dirname, '..', this.writeFolder, `${this.kvName}.json`), JSON.stringify(assorts, null, 4));
        this.logger.success(`Successful processing of trader offers`);
        return assorts;
    }

    isCashOffer = (offer) => {
        if (offer.cost.length > 1) {
            return false;
        }
        return Object.values(this.currencyId).includes(offer.cost[0].item);
    }

    offerMatchesPreset = (offer) => {
        const weaponPresets = Object.values(this.presets).filter(p => p.baseId === offer.item);
        presetLoop:
        for (const preset of weaponPresets) {
            if (preset.containsItems.length !== offer.contains.length) {
                continue;
            }
            for (const ci of preset.containsItems) {
                if (!offer.contains.some(part => part.item === ci.item.id)) {
                    continue presetLoop;
                }
            }
            return preset;
        }
        return false;
    }
}

const dogTagSideMap = {
    'Any': 'customdogtags12345678910',
    'Bear': '59f32bb586f774757e1e8442',
    'Usec': '59f32c3b86f77472a31742f0',
};

export default UpdateTraderAssortsJob;
