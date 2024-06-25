import DataJob from '../modules/data-job.mjs';
import dataMaps from '../modules/data-map.js';
import remoteData from '../modules/remote-data.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import { dashToCamelCase, camelCaseToTitleCase } from '../modules/string-functions.mjs';
import { setItemPropertiesOptions, getSpecialItemProperties } from '../modules/get-item-properties.js';
import webSocketServer from '../modules/websocket-server.mjs';
import { createAndUploadFromSource } from '../modules/image-create.mjs';

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
            this.traders,
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
            tarkovData.traders(),
        ]);
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
        this.kvData = {
            Item: itemData,
            ItemCategory: this.bsgCategories,
            HandbookCategory: this.handbookCategories
        }

        await setItemPropertiesOptions({
            job: this,
        });
            
        const priceFields = [
            'lastLowPrice',
            'avg24hPrice',
            'low24hPrice',
            'high24hPrice',
            'changeLast48h',
            'changeLast48hPercent',
        ];
        for (const [key, value] of this.itemMap.entries()) {
            if (value.types.includes('disabled') || value.types.includes('quest'))
                continue;
            if (!this.bsgItems[key] && !this.presets[key])
                continue;

            if (!value.image_8x_link && webSocketServer.launchedScanners() > 0) {
                try {
                    let image;
                    if (value.types.includes('preset')) {
                        image = await webSocketServer.getJsonImage(value.properties.items);
                    } else {
                        const images = await webSocketServer.getImages(key);
                        image = images[key];
                    }
                    await createAndUploadFromSource(image, key);
                    this.logger.success(`Created ${key} item images`);
                } catch (error) {
                    this.logger.error(`Error creating ${key} item images ${error}`);
                }
            }

            itemData[key] = {
                id: value.id,
                name: `${key} Name`,
                shortName: `${key} ShortName`,
                normalizedName: value.normalized_name,
                description: value.description,
                updated: value.updated,
                width: value.width,
                height: value.height,
                weight: value.weight,
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

            for (const fieldName of priceFields) {
                itemData[key][fieldName] = value[fieldName];
            }

            // clean up unused fields
            for (const fieldName in itemData[key]) {
                if (fieldName.includes('_')) {
                    Reflect.deleteProperty(itemData[key], fieldName);
                }
            }
            Reflect.deleteProperty(itemData[key], 'disabled');
            Reflect.deleteProperty(itemData[key], 'properties');

            const ignoreMissingBaseValueCategories = [
                '62f109593b54472778797866', // RandomLootContainer
            ];
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
            }  else if (this.bsgItems[key] && !ignoreMissingBaseValueCategories.includes(this.bsgItems[key]?._parent)) {
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

                    itemData[key].properties.defaultWidth = preset?.width ?? null;
                    itemData[key].properties.defaultHeight = preset?.height ?? null;
                    itemData[key].properties.defaultErgonomics = preset?.ergonomics ?? null;
                    itemData[key].properties.defaultRecoilVertical = preset?.verticalRecoil ?? null;
                    itemData[key].properties.defaultRecoilHorizontal = preset?.horizontalRecoil ?? null;
                    itemData[key].properties.defaultWeight = preset?.weight ?? null;
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

            item.lastLowPricePve = baseItem.lastLowPricePve;
            item.avg24hPricePve = baseItem.avg24hPricePve;
            item.low24hPricePve = baseItem.low24hPricePve;
            item.high24hPricePve = baseItem.high24hPricePve;
            item.changeLast48hPve = baseItem.changeLast48hPve;
            item.changeLast48hPercentPve = baseItem.changeLast48hPercentPve;
            item.lastOfferCountPve = baseItem.lastOfferCountPve;
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
            name: this.addTranslation('FleaMarket', (lang) => {
                return lang['RAG FAIR'].replace(/(?<!^|\s)\p{Lu}/gu, substr => {
                    return substr.toLowerCase();
                });
            }),
            normalizedName: 'flea-market',
            minPlayerLevel: this.globals.config.RagFair.minUserLevel,
            enabled: this.globals.config.RagFair.enabled,
            sellOfferFeeRate: (this.globals.config.RagFair.communityItemTax / 100),
            sellRequirementFeeRate: (this.globals.config.RagFair.communityRequirementTax / 100),
            foundInRaidRequired: this.globals.config.RagFair.isOnlyFoundInRaidAllowed,
            reputationLevels: this.globals.config.RagFair.maxActiveOfferCount.reduce((levels, offerCount) => {
                if (levels.length > 0 && levels[levels.length-1].offers === offerCount.count) {
                    levels[levels.length-1].maxRep = offerCount.to;
                    return levels;
                }
                levels.push({
                    offers: offerCount.count,
                    offersSpecialEditions: offerCount.countForSpecialEditions,
                    minRep: offerCount.from,
                    maxRep: offerCount.to
                });
                return levels;
            }, []),
        };

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

        this.kvData.Skill = [];
        for (const skillKey in this.globals.config.SkillsSettings) {
            const skillData = this.globals.config.SkillsSettings[skillKey];
            //console.log(skillKey, typeof skillData);
            if (typeof skillData !== 'object') {
                continue;
            }
            if (!this.hasTranslation(skillKey, true)) {
                continue;
            }
            this.kvData.Skill.push({
                id: skillKey,
                name: this.addTranslation(skillKey),
            });
        }

        this.kvData.Mastering = this.globals.config.Mastering.map(m => {
            return {
                id: m.Name,
                weapons: m.Templates.filter(id => !!itemData[id]),
                level2: m.Level2,
                level3: m.Level3,
            };
        });

        this.kvData.ItemType = ['any', ...itemTypesSet].sort();
        this.kvData.FleaMarket = fleaData;
        this.kvData.ArmorMaterial = armorData;
        this.kvData.PlayerLevel = levelData;
        this.kvData.LanguageCode = Object.keys(this.locales).sort();
        await this.cloudflarePut();

        const schemaData = {
            ItemType: ['any', ...itemTypesSet].sort().join('\n '),
            ItemCategory: Object.values(this.bsgCategories).map(cat => cat.enumName).sort().join('\n  '),
            //ItemSourceName: [],
            HandbookCategory: Object.values(this.handbookCategories).map(cat => cat.enumName).sort().join('\n  '),
            LanguageCode: Object.keys(this.locales).sort().join('\n '),
            //TraderName: [],
        };
        await this.cloudflarePut(schemaData, 'schema_data');

        for (const gameMode of this.gameModes) {
            if (gameMode.name === 'regular') {
                continue;
            }
            const modeData = {
                ...this.kvData,
            };
            modeData.Item = {};
            for (const id in this.kvData.Item) {
                const item = this.kvData.Item[id];
                modeData.Item[id] = {
                    ...item,
                    traderPrices: item.traderPrices.filter(tp => tp.trader !== '6617beeaa9cfa777ca915b7c'),
                };
                const dbItem = this.itemMap.get(id);
                for (const fieldName of priceFields) {
                    modeData.Item[id][fieldName] = dbItem[`${fieldName}_${gameMode.name}`];
                }
            }
            await this.cloudflarePut(modeData, `${this.kvName}_${gameMode.name}`);
        }

        return this.kvData;
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
        this.bsgCategories[id].normalizedName = this.normalizeName(this.getTranslation(this.bsgCategories[id].name));
        this.bsgCategories[id].enumName = catNameToEnum(this.getTranslation(this.bsgCategories[id].name));
    
        this.addCategory(this.bsgCategories[id].parent_id);
    }

    addHandbookCategory(id) {
        if (!id || this.handbookCategories[id]) {
            return;
        }
        this.handbookCategories[id] = {
            id: id,
            name: this.addTranslation(id),
            normalizedName: this.normalizeName(this.locales.en[id]),
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
        for (const id in this.traders) {
            if (id === traderId) {
                const buyCoef = parseInt(this.traders[id].loyaltyLevels[0].buy_price_coef);
                return buyCoef ? (100 - buyCoef) / 100 : 0.0001;
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

        for (const traderId in this.traders) {
            const trader = this.traders[traderId];
            if (trader.items_buy_prohibited.id_list.includes(item.id)) {
                continue;
            }
            if (trader.items_buy_prohibited.category.some(bannedCatId => item.categories.includes(bannedCatId))) {
                continue;
            }
            if (!trader.items_buy.id_list.includes(item.id) && !trader.items_buy.category.some(buyCatId => item.categories.includes(buyCatId))) {
                continue;
            }
            let currency = trader.currency;
            let priceRUB = Math.floor(this.getTraderMultiplier(traderId) * item.basePrice);
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
            const tradername = this.locales.en[`${traderId} Nickname`];
            traderPrices.push({
                name: tradername,
                price: priceCUR,
                currency: currency,
                currencyItem: currencyId[currency],
                priceRUB: priceRUB,
                trader: traderId,
                source: this.normalizeName(tradername),
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

export default UpdateItemCacheJob;
