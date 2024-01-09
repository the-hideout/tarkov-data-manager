const dataMaps = require('../modules/data-map');
const remoteData = require('../modules/remote-data');
const tarkovData = require('../modules/tarkov-data');
const {dashToCamelCase, camelCaseToTitleCase} = require('../modules/string-functions');
const { setItemPropertiesOptions, getSpecialItemProperties } = require('../modules/get-item-properties');
const { initPresetData, getPresetData } = require('../modules/preset-data');
const normalizeName = require('../modules/normalize-name');
const DataJob = require('../modules/data-job');

class UpdateItemCacheJob extends DataJob {
    constructor() {
        super('update-item-cache');
        this.kvName = 'item_data';
    }

    run = async () => {
        this.logger.time('items-with-prices');
        [
            this.bsgItems, 
            this.credits, 
            this.locales, 
            this.globals, 
            this.itemMap,
            this.handbook,
        ] = await Promise.all([
            tarkovData.items(), 
            tarkovData.credits(),
            tarkovData.locales(),
            tarkovData.globals(),
            remoteData.getWithPrices(true).then(results => {
                this.logger.timeEnd('items-with-prices');
                return results;
            }),
            tarkovData.handbook(),
        ]);
        this.traderData = await this.jobManager.jobOutput('update-traders', this);
        this.presets = await this.jobManager.jobOutput('update-presets', this, true);
        this.presetsLocale = this.presets.locale;
        this.presets = this.presets.presets;
        // make sure we don't include any disabled presets
        this.presets = Object.keys(this.presets).reduce((all, presetId) => {
            if (this.itemMap.has(presetId) && !this.itemMap.get(presetId).types.includes('disabled')) {
                all[presetId] = this.presets[presetId];
            }
            return all;
        }, {});
        const itemData = {};
        const itemTypesSet = new Set();
        this.bsgCategories = {};
        this.handbookCategories = {};
        initPresetData(this.bsgItems, this.credits);

        await setItemPropertiesOptions({
            job: this,
        });
        for (const [key, value] of this.itemMap.entries()) {
            if (value.types.includes('disabled') || value.types.includes('quest'))
                continue;
            if (!this.bsgItems[key] && !this.presets[key])
                continue;

            itemData[key] = {
                ...value,
                name: `${key} Name`,
                shortName: `${key} ShortName`,
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
                // add base value for built-in armor pieces
                this.bsgItems[key]._props.Slots?.forEach(slot => {
                    slot._props?.filters?.forEach(filter => {
                        if (!filter.Plate || !filter.locked) {
                            return;
                        }
                        itemData[key].basePrice += this.credits[filter.Plate];
                    });
                });
            }  else {
                this.logger.warn(`Unknown base value for ${this.getTranslation(itemData[key].name)} ${key}`);
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

                    const defaultData = await getPresetData(itemData[key], this.logger);
                    itemData[key].properties.defaultWidth = defaultData.width;
                    itemData[key].properties.defaultHeight = defaultData.height;
                    itemData[key].properties.defaultErgonomics = defaultData.ergonomics;
                    itemData[key].properties.defaultRecoilVertical = defaultData.verticalRecoil;
                    itemData[key].properties.defaultRecoilHorizontal = defaultData.horizontalRecoil;
                    itemData[key].properties.defaultWeight = defaultData.weight;
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
                    });
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
                    default: preset.default,
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
                this.logger.log(`Item ${this.getTranslation(itemData[key].name)} (${key}) is neither an item nor a preset`);
                delete itemData[key];
                continue;
            }
            if (itemData[key].properties && !itemData[key].properties.propertiesType) {
                this.logger.warn(`${this.getTranslation(itemData[key].name)} ${key} lacks propertiesType`);
                itemData[key].properties = null;
            }

            // translations
            if (this.hasTranslation(`${key} Name`)) { 
                itemData[key].name = this.addTranslation(`${key} Name`);
                itemData[key].shortName = this.addTranslation(`${key} ShortName`);
                itemData[key].description = this.addTranslation(`${key} Description`);
            } else if (this.presets[key]) {
                for (const langCode in this.presets[key].locale) {
                    if (this.presets[key].locale[langCode].name) {
                        this.addTranslation(`${key} Name`, langCode, this.presets[key].locale[langCode].name);
                    }
                    if (this.presets[key].locale[langCode].shortName) {
                        this.addTranslation(`${key} ShortName`, langCode, this.presets[key].locale[langCode].shortName);
                    }
                }
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
                //this.logger.warn(`Item ${this.locales.en[itemData[key].name] || this.kvData.locale.en[itemData[key].name]} ${key} has no handbook entry`);
            } else {
                this.addHandbookCategory(handbookItem.ParentId);
                let parent = this.handbookCategories[handbookItem.ParentId];
                while (parent) {
                    itemData[key].handbookCategories.push(parent.id);
                    parent = this.handbookCategories[parent.parent_id];
                }
            }

            itemData[key].types.forEach(itemType => {
                itemTypesSet.add(itemType);
            });
        }

        // merge preset translations
        this.mergeTranslations(this.presetsLocale);

        // Add trader prices
        for (const id in itemData) {
            if (itemData[id].types.includes('preset') && id !== 'customdogtags12345678910') {
                itemData[id].traderPrices = itemData[id].containsItems.reduce((traderPrices, part) => {
                    const partPrices = this.getTraderPrices(itemData[part.item]);
                    for (const partPrice of partPrices) {
                        const totalPrice = traderPrices.find(price => price.trader === partPrice.trader);
                        if (totalPrice) {
                            totalPrice.price += (partPrice.price * part.count);
                            totalPrice.priceRUB += (partPrice.priceRUB * part.count);
                            continue;
                        }
                        traderPrices.push(partPrice);
                    }
                    return traderPrices;
                }, []);
            } else {
                itemData[id].traderPrices = this.getTraderPrices(itemData[id]);
            }
            
            const ignoreCategories = [
                '543be5dd4bdc2deb348b4569', // currency
                '5448bf274bdc2dfc2f8b456a', // secure container
                '62f109593b54472778797866', // random loot container
            ];
            if (itemData[id].traderPrices.length === 0 && !ignoreCategories.includes(itemData[id].bsgCategoryId)) {
                //this.logger.warn(`No trader sell prices mapped for ${this.locales.en[itemData[id].name]} (${id}) with category id ${itemData[id].bsgCategoryId}`);
            }
        }

        //add flea prices from base items to default presets
        for (const item of Object.values(itemData)) {
            if (!item.types.includes('preset')) {
                continue;
            }
            const baseItem = itemData[item.properties.base_item_id];
            if (baseItem.properties?.defaultPreset !== item.id) {
                continue;
            }
            item.updated = baseItem.updated;
            item.lastLowPrice = baseItem.lastLowPrice;
            item.avg24hPrice = baseItem.avg24hPrice;
            item.low24hPrice = baseItem.low24hPrice;
            item.high24hPrice = baseItem.high24hPrice;
            item.changeLast48h = baseItem.changeLast48h;
            item.changeLast48hPercent = baseItem.changeLast48hPercent;
            item.lastOfferCount = baseItem.lastOfferCount;
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

            // validate contained items
            item.containsItems = item.containsItems.reduce((allContents, contained) => {
                if (itemData[contained.item]) {
                    allContents.push(contained);
                } else {
                    this.logger.warn(`Item ${this.locales.en[`${id} Name`]} ${id} has non-existant contained item ${contained.item}`);
                }
                return allContents;
            }, []);

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
                    this.logger.log(`${this.locales.en[item.name]} ${item.id} could not categorize conflicting item id ${conId}`);
                }
            });
        }

        const fleaData = {
            name: 'FleaMarket',
            normalizedName: 'flea-market',
            minPlayerLevel: this.globals.config.RagFair.minUserLevel,
            enabled: this.globals.config.RagFair.enabled,
            sellOfferFeeRate: (this.globals.config.RagFair.communityItemTax / 100),
            sellRequirementFeeRate: (this.globals.config.RagFair.communityRequirementTax / 100),
            reputationLevels: [],
        };
        for (const langCode in this.locales) {
            this.addTranslation('FleaMarket', langCode, this.locales[langCode]['RAG FAIR'].replace(/(?<!^|\s)\p{Lu}/gu, substr => {
                return substr.toLowerCase();
            }));
        }
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
                name: this.addTranslation('Mat'+armorTypeId),
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
            LanguageCode: Object.keys(this.locales).sort(),
            ...this.kvData,
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
        if (!id || this.bsgCategories[id]) {
            return;
        }
        this.bsgCategories[id] = {
            id: id,
            parent_id: this.bsgItems[id]._parent,
            child_ids: [],
            name: this.addTranslation(`${id} Name`, (lang, langCode) => {
                if (lang[`${id} Name`]) {
                    return lang[`${id} Name`];
                } else {
                    if (langCode === 'en') {
                        this.logger.warn(`${id} ${this.bsgItems[id]._name} category mising translation`);
                    }
                    if (langCode !== 'en' && this.hasTranslation(`${id} Name`)) {
                        return this.locales.en[`${id} Name`];
                    }
                    return camelCaseToTitleCase(this.bsgItems[id]._name);
                }
            }),
        };
        this.bsgCategories[id].normalizedName = normalizeName(this.kvData.locale.en[this.bsgCategories[id].name]);
        this.bsgCategories[id].enumName = catNameToEnum(this.kvData.locale.en[this.bsgCategories[id].name]);
    
        this.addCategory(this.bsgCategories[id].parent_id);
    }

    addHandbookCategory(id) {
        if (!id || this.handbookCategories[id]) {
            return;
        }
        this.handbookCategories[id] = {
            id: id,
            name: this.addTranslation(id),
            normalizedName: normalizeName(this.locales.en[id]),
            enumName: catNameToEnum(this.locales.en[id]),
            parent_id: null,
            child_ids: [],
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
    
        item.hasGrid = false;
        const grid = getGrid(this.bsgItems[item.id]);
        if (grid && grid.totalSize > 0){
            item.hasGrid = true;
        }
    }

    getTraderPrices(item) {
        const traderPrices = [];
        if (!item) {
            return traderPrices;
        }
        const currenciesNow = {
            'RUB': 1,
            'USD': this.credits['5696686a4bdc2da3298b456a'],
            'EUR': this.credits['569668774bdc2da2298b4568']
            //'USD': Math.round(this.credits['5696686a4bdc2da3298b456a'] * 1.1045104510451),
            //'EUR': Math.round(this.credits['569668774bdc2da2298b4568'] * 1.1530984204131)
        };
        const currencyId = dataMaps.currencyIsoId;

        for (const trader of this.traderData) {
            if (trader.items_buy_prohibited.id_list.includes(item.id) || dataMaps.sellToTrader[trader.name]?.prohibitedAdded?.ids.includes(item.id)) {
                continue;
            }
            if (trader.items_buy_prohibited.category.some(bannedCatId => item.categories.includes(bannedCatId))) {
                continue;
            }
            if (!trader.items_buy.id_list.includes(item.id) && !trader.items_buy.category.some(buyCatId => item.categories.includes(buyCatId))) {
                continue;
            }
            let currency = trader.currency;
            let priceRUB = Math.floor(this.getTraderMultiplier(trader.id) * item.basePrice);
            let priceCUR = priceRUB;
            if (currency !== 'RUB') {
                // for if we ever switch the price field to a float
                //priceCUR = Math.round((priceRUB / currenciesNow[currency]) * 100) / 100;
                priceCUR = priceRUB / currenciesNow[currency];
                if (priceCUR > 0) {
                    priceCUR = Math.round(priceCUR);
                } else {
                    priceCUR = 0;
                }
            }
            traderPrices.push({
                name: this.locales.en[trader.name],
                price: priceCUR,
                currency: currency,
                currencyItem: currencyId[currency],
                priceRUB: priceRUB,
                trader: trader.id,
                source: trader.normalizedName,
            });
        }
        return traderPrices;
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
