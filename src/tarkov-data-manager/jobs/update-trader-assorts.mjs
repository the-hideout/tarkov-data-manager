import fs from 'fs';
import path from 'path';

import DataJob from '../modules/data-job.mjs';
import remoteData from '../modules/remote-data.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import presetData from '../modules/preset-data.mjs';

class UpdateTraderAssortsJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-trader-assorts'});
        this.writeFolder = 'cache';
        this.kvName = 'trader_assorts';
    }

    async run() {
        [this.tasks, this.traders, this.presets, this.items, this.bsgItems, this.en] = await Promise.all([
            this.jobManager.jobOutput('update-quests', this),
            tarkovData.traders(),
            presetData.getAllPresets(),
            remoteData.get(),
            tarkovData.items(),
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
            const traderId = trader._id;
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
                tarkovData.traderQuestAssorts(traderId, {download: true}).catch(error => {
                    this.logger.error(`Error downloading quest assorts: ${error.message}`);
                    return tarkovData.traderQuestAssorts(traderId);
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
                    let offerItemId = offer._items[0]._tpl;
                    const filteredItems = offer._items.filter(i => {
                        // filter out soft armor inserts and ammo inside packs
                        const bsgItem = this.bsgItems[i._tpl];
                        if (bsgItem._parent === '65649eb40bf0ed77b8044453') {
                            return false;
                        }
                        // filter contained ammo out of packs
                        if (i.parentId) {
                            const parentSlot = offer._items.find(i2 => i2._id === i.parentId);
                            const bsgParent = this.bsgItems[parentSlot._tpl];
                            if (i.slotId === 'cartridges' && bsgParent._parent === '543be5cb4bdc2deb348b4568') {
                                return false;
                            }
                        }
                        return true;
                    });
                    if (filteredItems.length > 1) {
                        const preset = presetData.findPreset(filteredItems);
                        if (preset) {
                            offerItemId = preset.id;
                        }
                    }
                    return {
                        id: offer._id,
                        item: offerItemId,
                        itemName: this.items.get(offerItemId).name,
                        baseItem: offerItemId,
                        stock: offer._items[0].upd.StackObjectsCount,
                        unlimitedStock: Boolean(offer._items[0].upd.UnlimitedCount),
                        buyLimit: offer._items[0].upd.BuyRestrictionMax || 0,
                        taskUnlock: questAssort[offer._id],
                        minLevel: assort.loyal_level_items[offer._id],
                        barter: false,
                        _items: offer._items,
                        contains: offer._items.reduce((contents, i) => {
                            if (!this.items.get(i._tpl)) {
                                return contents;
                            }
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
                                reqId = dogTagSideMap[req.side] ?? reqId;
                                if (!dogTagSideMap[req.side]) {
                                    console.log(`Invalid side ${req.side} for item ${reqId}`, req);
                                }
                            }
                            return {
                                item: reqId,
                                itemName: this.items.get(reqId).name,
                                count: req.count,
                                dogTagLevel: req.level,
                                dogTagSide: req.side,
                            };
                        }).filter(Boolean),
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
            }
        }
        if (totalOffers === 0) {
            return Promise.reject(new Error('No trader offers found'));
        }
        for (const traderId in assorts) {
            //const trader = this.traders.find(t => t._id === traderId);
            this.logger.log(`✔️ ${this.en[`${traderId} Nickname`]}: ${assorts[traderId].length} offers`);
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
}

const dogTagSideMap = {
    'Any': 'customdogtags12345678910',
    'Bear': '59f32bb586f774757e1e8442',
    'Usec': '59f32c3b86f77472a31742f0',
};

export default UpdateTraderAssortsJob;
