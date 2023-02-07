const roundTo = require('round-to');

const dataMaps = require('../modules/data-map');
const remoteData = require('../modules/remote-data');
const { query } = require('../modules/db-connection');
const tarkovData = require('../modules/tarkov-data');
const {dashToCamelCase} = require('../modules/string-functions');
const { setItemPropertiesOptions, getSpecialItemProperties } = require('../modules/get-item-properties');
const { initPresetSize, getPresetSize } = require('../modules/preset-size');
const normalizeName = require('../modules/normalize-name');
const { setLocales, getTranslations } = require('../modules/get-translation');
const DataJob = require('../modules/data-job');

class UpdateItemCacheJob extends DataJob {
    constructor() {
        super('update-item-cache');
        this.kvName = 'item_data';
    }

    run = async () => {
        this.logger.time('price-yesterday-query');
        const avgPriceYesterdayPromise = query(`
            SELECT
                avg(price) AS priceYesterday,
                item_id
            FROM
                price_data
            WHERE
                timestamp > DATE_SUB(NOW(), INTERVAL 2 DAY)
            AND
                timestamp < DATE_SUB(NOW(), INTERVAL 1 DAY)
            GROUP BY
                item_id
        `).then(results => {
            this.logger.timeEnd('price-yesterday-query');
            return results;
        });

        const lastWipe = await query('SELECT start_date FROM wipe ORDER BY start_date DESC LIMIT 1');
        if (lastWipe.length < 1) {
            lastWipe.push({start_date: 0});
        }

        this.logger.time('last-low-price-query');
        const lastKnownPriceDataPromise = query(`
            SELECT
                price,
                a.timestamp,
                a.item_id
            FROM
                price_data a
            INNER JOIN (
                SELECT
                    max(timestamp) as timestamp,
                    item_id
                FROM
                    price_data
                WHERE
                    timestamp > ?
                GROUP BY
                    item_id
            ) b
            ON
                a.timestamp = b.timestamp
            GROUP BY
                item_id, timestamp, price;
        `, [lastWipe[0].start_date]).then(results => {
            this.logger.timeEnd('last-low-price-query');
            return results;
        });

        let avgPriceYesterday, lastKnownPriceData, itemMap;
        [
            this.bsgItems, 
            this.credits, 
            this.locales, 
            this.globals, 
            avgPriceYesterday, 
            lastKnownPriceData, 
            itemMap,
            this.handbook,
        ] = await Promise.all([
            tarkovData.items(), 
            tarkovData.credits(),
            tarkovData.locales(),
            tarkovData.globals(),
            avgPriceYesterdayPromise,
            lastKnownPriceDataPromise,
            remoteData.getWithPrices(true),
            tarkovData.handbook(),
        ]);
        this.traderData = await this.jobManager.jobOutput('update-traders', this);
        this.presets = await this.jobManager.jobOutput('update-presets', this, true);
        const itemData = {};
        const itemTypesSet = new Set();
        this.bsgCategories = {};
        this.handbookCategories = {};
        initPresetSize(this.bsgItems, this.credits);

        await setItemPropertiesOptions({
            job: this, 
            itemIds: [...itemMap.keys()],
            disabledItemIds: [...itemMap.values()].filter(item => item.types.includes('disabled')).map(item => item.id)
        });
        setLocales(this.locales);
        for (const [key, value] of itemMap.entries()) {
            if (value.types.includes('disabled') || value.types.includes('quest'))
                continue;
            if (!this.bsgItems[key] && !this.presets[key])
                continue;

            itemData[key] = {
                ...value,
                shortName: value.short_name,
                normalizedName: value.normalized_name,
                lastOfferCount: value.last_offer_count,
                types: value.types.map(type => dashToCamelCase(type)).filter(type => type !== 'onlyFlea'),
                wikiLink: value.wiki_link,
                link: `https://tarkov.dev/item/${value.normalized_name}`,
                iconLink: value.icon_link || 'https://assets.tarkov.dev/unknown-item-icon.jpg',
                gridImageLink: value.grid_image_link || 'https://assets.tarkov.dev/unknown-item-grid-image.jpg',
                baseImageLink: value.base_image_link || 'https://assets.tarkov.dev/unknown-item-base-image.png',
                inspectImageLink: value.image_link || 'https://assets.tarkov.dev/unknown-item-inspect.webp',
                image512pxLink: value.image_512_link || 'https://assets.tarkov.dev/unknown-item-512.webp',
                image8xLink: value.image_8x_link || 'https://assets.tarkov.dev/unknown-item-512.webp',
                containsItems: [],
                discardLimit: -1,
                basePrice: 0,
                categories: [],
                handbookCategories: [],
            };

            // clean up unused fields
            for (const fieldName in itemData[key]) {
                if (fieldName.includes('_')) {
                    Reflect.deleteProperty(itemData[key], fieldName);
                }
            }
            Reflect.deleteProperty(itemData[key], 'disabled');
            Reflect.deleteProperty(itemData[key], 'properties');

            // add base value
            if (this.presets[key]) {
                itemData[key].basePrice = this.presets[key].baseValue;
            } else if (this.credits[key]) {
                itemData[key].basePrice = this.credits[key];
            }  else {
                this.logger.warn(`Unknown base value for ${itemData[key].name} ${key}`);
            }

            // Only add these if it's allowed on the flea market
            if (!itemData[key].types.includes('no-flea')) {
                let itemPriceYesterday = avgPriceYesterday.find(row => row.item_id === key);

                if (!itemPriceYesterday || itemData[key].avg24hPrice === 0) {
                    itemData[key].changeLast48h = 0;
                    itemData[key].changeLast48hPercent = 0;
                } else {
                    itemData[key].changeLast48h = Math.round(itemData[key].avg24hPrice - itemPriceYesterday.priceYesterday);
                    const percentOfDayBefore = itemData[key].avg24hPrice / itemPriceYesterday.priceYesterday;
                    itemData[key].changeLast48hPercent = roundTo((percentOfDayBefore - 1) * 100, 2);
                }

                if (!itemData[key].lastLowPrice) {
                    let lastKnownPrice = lastKnownPriceData.find(row => row.item_id === key);
                    if (lastKnownPrice) {
                        itemData[key].updated = lastKnownPrice.timestamp;
                        itemData[key].lastLowPrice = lastKnownPrice.price;
                    }
                }
            } else {
                //remove flea price data if an item has been marked as no flea
                //delete itemData[key].lastLowPrice;
                //delete itemData[key].avg24hPrice;
                itemData[key].lastLowPrice = 0;
                itemData[key].avg24hPrice = 0;
            }

            // add item properties
            if (this.bsgItems[key]) {
                this.addPropertiesToItem(itemData[key]);
                itemData[key].bsgCategoryId = this.bsgItems[key]._parent;
                itemData[key].discardLimit = this.bsgItems[key]._props.DiscardLimit;
                itemData[key].backgroundColor = this.bsgItems[key]._props.BackgroundColor;
                itemData[key].properties = await getSpecialItemProperties(this.bsgItems[key]);
                if (value.types.includes('gun')) {
                    itemData[key].properties.presets = Object.values(this.presets).filter(preset => preset.baseId === key).map(preset => preset.id);

                    const preset = Object.values(this.presets).find(preset => preset.default && preset.baseId === key);
                    if (preset) {
                        itemData[key].containsItems = preset.containsItems.reduce((containedItems, contained) => {
                            if (contained.item.id !== key) {
                                containedItems.push({
                                    item: contained.item.id,
                                    count: contained.count,
                                    attributes: []
                                });
                            }
                            return containedItems;
                        }, []);
                    }

                    const defaultSize = await getPresetSize(itemData[key], this.logger);
                    itemData[key].properties.defaultWidth = defaultSize.width;
                    itemData[key].properties.defaultHeight = defaultSize.height;
                    itemData[key].properties.defaultErgonomics = defaultSize.ergonomics;
                    itemData[key].properties.defaultRecoilVertical = defaultSize.verticalRecoil;
                    itemData[key].properties.defaultRecoilHorizontal = defaultSize.horizontalRecoil;
                    itemData[key].properties.defaultWeight = defaultSize.weight;
                }
                // add ammo box contents
                if (itemData[key].bsgCategoryId === '543be5cb4bdc2deb348b4568') {
                    const ammoContents = this.bsgItems[key]._props.StackSlots[0];
                    const count = ammoContents._max_count;
                    const round = ammoContents._props.filters[0].Filter[0];
                    itemData[key].containsItems.push({
                        item: round,
                        count: count,
                        attributes: []
                    })
                }
            } else if (this.presets[key]) {
                const preset = this.presets[key];
                itemData[key].width = preset.width;
                itemData[key].height = preset.height;
                itemData[key].weight = preset.weight;
                itemData[key].bsgCategoryId = preset.bsgCategoryId;
                itemData[key].backgroundColor = preset.backgroundColor;
                itemData[key].properties = {
                    propertiesType: 'ItemPropertiesPreset',
                    base_item_id: preset.baseId,
                    ergonomics: preset.ergonomics,
                    recoilVertical: preset.verticalRecoil,
                    recoilHorizontal: preset.horizontalRecoil,
                    moa: preset.moa,
                };
                if ((itemData[preset.baseId]?.types.includes('noFlea') || itemData[preset.baseId]?.types.includes('no-flea')) && !itemData[key].types.includes('noFlea')) {
                    itemData[key].types.push('noFlea');
                }
                itemData[key].containsItems = preset.containsItems.map(contained => {
                    return {
                        item: contained.item.id,
                        count: contained.count,
                        attributes: []
                    };
                });
            } else if (!itemData[key].types.includes('disabled')) {
                this.logger.log(`Item ${itemData[key].name} (${key}) is neither an item nor a preset`);
                delete itemData[key];
                continue;
            }
            if (itemData[key].properties && !itemData[key].properties.propertiesType) {
                this.logger.warn(`${itemData[key].name} ${key} lacks propertiesType`);
                itemData[key].properties = null;
            }

            // add template categories
            this.addCategory(itemData[key].bsgCategoryId);
            const cat = this.bsgCategories[itemData[key].bsgCategoryId];
            if (cat) {
                itemData[key].categories.push(itemData[key].bsgCategoryId);
                let parent = this.bsgCategories[cat.parent_id];
                while (parent) {
                    itemData[key].categories.push(parent.id);
                    parent = this.bsgCategories[parent.parent_id];
                }
            }

            // add handbook categories
            const handbookItemId = itemData[key].types.includes('preset') ? itemData[key].properties.base_item_id : key;
            const handbookItem = this.handbook.Items.find(hbi => hbi.Id === handbookItemId);
            if (!handbookItem) {
                this.logger.warn(`Item ${itemData[key].name} ${key} has no handbook entry`);
            } else {
                this.addHandbookCategory(handbookItem.ParentId);
                let parent = this.handbookCategories[handbookItem.ParentId];
                while (parent) {
                    itemData[key].handbookCategories.push(parent.id);
                    parent = this.handbookCategories[parent.parent_id];
                }
            }

            // translations
            if (this.locales.en[`${key} Name`]) { 
                itemData[key].locale = getTranslations({
                    name: `${key} Name`,
                    shortName: `${key} ShortName`,
                    description: `${key} Description`,
                }, this.logger);
            } else if (this.presets[key]) {
                itemData[key].locale = {};
                for (const code in this.locales) {
                    itemData[key].locale[code] = this.presets[key].locale[code];
                }
            }

            // Add trader prices
            itemData[key].traderPrices = [];
            const currenciesNow = {
                'RUB': 1,
                'USD': this.credits['5696686a4bdc2da3298b456a'],
                'EUR': this.credits['569668774bdc2da2298b4568']
                //'USD': Math.round(this.credits['5696686a4bdc2da3298b456a'] * 1.1045104510451),
                //'EUR': Math.round(this.credits['569668774bdc2da2298b4568'] * 1.1530984204131)
            };
            const currencyId = dataMaps.currencyIsoId;
            for (const trader of this.traderData) {
                if (trader.items_buy_prohibited.id_list.includes(key)) {
                    continue;
                }
                if (trader.items_buy_prohibited.category.some(bannedCatId => itemData[key].categories.includes(bannedCatId))) {
                    continue;
                }
                if (!trader.items_buy.id_list.includes(key) && !trader.items_buy.category.some(buyCatId => itemData[key].categories.includes(buyCatId))) {
                    continue;
                }
                let currency = trader.currency;
                let priceRUB = Math.floor(this.getTraderMultiplier(trader.id) * itemData[key].basePrice);
                const priceCUR = Math.round(priceRUB / currenciesNow[currency]);
                if (priceCUR === 0) {
                    priceRUB = 0;
                }
                itemData[key].traderPrices.push({
                    name: trader.name,
                    price: priceCUR,
                    currency: currency,
                    currencyItem: currencyId[currency],
                    priceRUB: priceRUB,
                    trader: trader.id
                });
            }
            const ignoreCategories = [
                '543be5dd4bdc2deb348b4569', // currency
                '5448bf274bdc2dfc2f8b456a', // secure container
            ];
            if (itemData[key].traderPrices.length === 0 && !ignoreCategories.includes(itemData[key].bsgCategoryId)) {
                this.logger.log(`No trader sell prices mapped for ${itemData[key].name} (${itemData[key].id}) with category id ${itemData[key].bsgCategoryId}`);
            }

            itemData[key].types.forEach(itemType => {
                itemTypesSet.add(itemType);
            });
        }

        // populate child ids for tempalte categories
        Object.values(this.bsgCategories).forEach(cat => {
            this.bsgCategories[cat.parent_id]?.child_ids.push(cat.id);
        });
        
        // populate child ids for handbook categories
        Object.values(this.handbookCategories).forEach(cat => {
            if (this.handbookCategories[cat.parent_id]?.child_ids.includes(cat.id)) {
                return;
            }
            this.handbookCategories[cat.parent_id]?.child_ids.push(cat.id);
        });

        const slotIds = [];

        for (const id in this.bsgItems) {
            if (!this.bsgItems[id] || !this.bsgItems[id]._props.Slots) {
                continue;
            }
            this.bsgItems[id]._props.Slots.forEach(slot => {
                slotIds.push(slot._id);
            });
        }

        for (const id in itemData) {
            const item = itemData[id];
            item.conflictingItems = [];
            item.conflictingSlotIds = [];
            item.conflictingCategories = [];
            if (item.types.includes('preset')) {
                continue;
            }
            this.bsgItems[id]._props.ConflictingItems.forEach(conId => {                
                if (itemData[conId]) {
                    item.conflictingItems.push(conId);
                } else if (slotIds.includes(conId)) {
                    item.conflictingSlotIds.push(conId);
                } else if (this.bsgCategories[conId]) {
                    item.conflictingCategories.push(conId);
                } else if (this.bsgItems[id]) {
                    //this.logger.log(`${conId} is probably disabled`);
                } else {
                    this.logger.log(`${item.name} ${item.id} could not categorize conflicting item id ${conId}`);
                }
            });
        }

        const fleaData = {
            name: 'Flea Market',
            normalizedName: 'flea-market',
            minPlayerLevel: this.globals.config.RagFair.minUserLevel,
            enabled: this.globals.config.RagFair.enabled,
            sellOfferFeeRate: (this.globals.config.RagFair.communityItemTax / 100),
            sellRequirementFeeRate: (this.globals.config.RagFair.communityRequirementTax / 100),
            reputationLevels: [],
            locale: getTranslations({name: lang => {
                return lang['RAG FAIR'].replace(/(?<!^|\s)\p{Lu}/gu, substr => {
                    return substr.toLowerCase();
                });
            }}, this.logger),
        };
        for (const offerCount of this.globals.config.RagFair.maxActiveOfferCount) {
            if (fleaData.reputationLevels.length > 0 && fleaData.reputationLevels[fleaData.reputationLevels.length-1].offers == offerCount.count) {
                fleaData.reputationLevels[fleaData.reputationLevels.length-1].maxRep = offerCount.to;
                continue;
            }
            fleaData.reputationLevels.push({
                offers: offerCount.count,
                minRep: offerCount.from,
                maxRep: offerCount.to
            });
        }

        const armorData = {};
        for (const armorTypeId in this.globals.config.ArmorMaterials) {
            const armorType = this.globals.config.ArmorMaterials[armorTypeId];
            armorData[armorTypeId] = {
                id: armorTypeId,
                name: this.locales.en['Mat'+armorTypeId],
                locale: getTranslations({name: `Mat${armorTypeId}`}, this.logger),
            };
            for (const key in armorType) {
                armorData[armorTypeId][key.charAt(0).toLocaleLowerCase()+key.slice(1)] = armorType[key];
            }
        }

        const levelData = [];
        let currentLevel = 1;
        for (const level of this.globals.config.exp.level.exp_table) {
            levelData.push({
                level: currentLevel++,
                exp: level.exp
            });
        }

        const itemsData = {
            Item: itemData,
            ItemCategory: this.bsgCategories,
            HandbookCategory: this.handbookCategories,
            ItemType: ['any', ...itemTypesSet].sort(),
            FleaMarket: fleaData,
            ArmorMaterial: armorData,
            PlayerLevel: levelData,
            LanguageCode: Object.keys(this.locales).sort()
        };
        await this.cloudflarePut(itemsData);

        const schemaData = {
            updated: new Date(),
            ItemType: ['any', ...itemTypesSet].sort().join('\n '),
            ItemCategory: Object.values(this.bsgCategories).map(cat => cat.enumName).sort().join('\n  '),
            HandbookCategory: Object.values(this.handbookCategories).map(cat => cat.enumName).sort().join('\n  '),
            LanguageCode: Object.keys(this.locales).sort().join('\n '),
        };
        await this.cloudflarePut(schemaData, 'schema_data');

        return itemsData;
    }

    addCategory(id) {
        if (!id || this.bsgCategories[id]) return;
        this.bsgCategories[id] = {
            id: id,
            parent_id: this.bsgItems[id]._parent,
            child_ids: [],
            locale: getTranslations({
                name: lang => {
                    if (lang[`${id} Name`]) {
                        return lang[`${id} Name`];
                    } else {
                        return this.bsgItems[id]._name;
                    }
                }
            }, this.logger)
        };
        this.bsgCategories[id].normalizedName = normalizeName(this.bsgCategories[id].locale.en.name);
        this.bsgCategories[id].enumName = catNameToEnum(this.bsgCategories[id].locale.en.name);
    
        this.addCategory(this.bsgCategories[id].parent_id);
    }

    addHandbookCategory(id) {
        if (!id || this.handbookCategories[id]) return;
        this.handbookCategories[id] = {
            id: id,
            name: this.locales.en[id],
            normalizedName: normalizeName(this.locales.en[id]),
            enumName: catNameToEnum(this.locales.en[id]),
            parent_id: null,
            child_ids: [],
            locale: getTranslations({
                name: id,
            }, this.logger),
        };
    
        const category = this.handbook.Categories.find(cat => cat.Id === id);
        const parentId = category.ParentId;
        this.handbookCategories[id].parent_id = parentId;
        this.addHandbookCategory(parentId);
    }

    getTraderMultiplier(traderId) {
        for (const trader of this.traderData) {
            if (trader.id === traderId) {
                return trader.levels[0].payRate;
            }
        }
        throw error (`Trader with id ${traderId} not found in traders data`);
    }

    addPropertiesToItem(item) {
        if (item.types.includes('preset')) return;
        if(!this.bsgItems[item.id]?._props){
            return;
        }
    
        for(const propertyKey in mappingProperties){
            if (propertyKey in this.bsgItems[item.id]?._props == false) {
                continue;
            }
            let propertyValue = this.bsgItems[item.id]._props[propertyKey];
    
            if(typeof propertyValue === 'undefined'){
                continue;
            }
    
            // Skip falsy strings
            // Should be fixed for actual booleans
            if(typeof propertyValue === 'string' && propertyValue === '') {
                continue;
            }
    
            item[mappingProperties[propertyKey]] = propertyValue;
        }
    
        const grid = getGrid(this.bsgItems[item.id]);
        if(grid && grid.totalSize > 0){
            item.hasGrid = true;
        }  
    }
}

const catNameToEnum = (sentence) => {
    return sentence.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g,
    function(word, i) {
       if (+word === 0)
          return '';
       return i === 0 ? word :
       word.toUpperCase();
    }).replace(/[^a-zA-Z0-9]+/g, '');
};


const mappingProperties = {
    // 'BlindnessProtection',
    // 'speedPenaltyPercent',
    // 'mousePenalty',
    // 'weaponErgonomicPenalty',
    // 'armorZone',
    // 'ArmorMaterial',
    // 'headSegments',
    'BlocksEarpiece': 'blocksHeadphones',
    // 'DeafStrength',
    'MaxDurability': 'maxDurability',
    'armorClass': 'armorClass',
    'Accuracy': 'accuracyModifier',
    'Recoil': 'recoilModifier',
    'Ergonomics': 'ergonomicsModifier',
    'Weight': 'weight',
    'Width': 'width',
    'Height': 'height',
    'StackMaxSize': 'stackMaxSize',
    'Tracer': 'tracer',
    'TracerColor': 'tracerColor',
    'ammoType': 'ammoType',
    'ProjectileCount': 'projectileCount',
    'Damage': 'damage',
    'ArmorDamage': 'armorDamage',
    'FragmentationChance': 'fragmentationChance',
    'RicochetChance': 'ricochetChance',
    'PenetrationChance': 'penetrationChance',
    'PenetrationPower': 'penetrationPower',
    'ammoAccr': 'accuracy',
    'ammoRec': 'recoil',
    'InitialSpee': 'initialSpeed',
    'Velocity': 'velocity',
    'Loudness': 'loudness',
};

const getGrid = (item) => {
    if(!item._props.Grids){
        return false;
    }

    const gridData = {
        pockets: [],
        totalSize: 0,
    };

    for(const grid of item._props.Grids){
        gridData.totalSize = gridData.totalSize + grid._props.cellsH * grid._props.cellsV;
        gridData.pockets.push({
            height: grid._props.cellsH,
            width: grid._props.cellsV
        });
    }

    return gridData;
};

module.exports = UpdateItemCacheJob;
