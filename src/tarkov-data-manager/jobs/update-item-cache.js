const roundTo = require('round-to');

const dataMaps = require('../modules/data-map');
const {categories: sellCategories, items: sellItems} = require('../modules/category-map');
const cloudflare = require('../modules/cloudflare');
const remoteData = require('../modules/remote-data');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovData = require('../modules/tarkov-data');
const jobOutput = require('../modules/job-output');
const {dashToCamelCase} = require('../modules/string-functions');
const { setItemPropertiesOptions, getSpecialItemProperties } = require('../modules/get-item-properties');
const { initPresetSize, getPresetSize } = require('../modules/preset-size');
const normalizeName = require('../modules/normalize-name');
const { setLocales, getTranslations } = require('../modules/get-translation');

let bsgItems = false;
let credits = false;
let handbook = false;
let locales = false;
let traderData = false;
let logger = false;
let bsgCategories = {};
let handbookCategories = {};

const catNameToEnum = (sentence) => {
    return sentence.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g,
    function(word, i) {
       if (+word === 0)
          return '';
       return i === 0 ? word :
       word.toUpperCase();
    }).replace(/[^a-zA-Z0-9]+/g, '');
};

const addCategory = id => {
    if (!id || bsgCategories[id]) return;
    bsgCategories[id] = {
        id: id,
        parent_id: bsgItems[id]._parent,
        child_ids: [],
        locale: getTranslations({
            name: lang => {
                if (lang.templates[id]) {
                    return lang.templates[id].Name
                } else {
                    return bsgItems[id]._name
                }
            }
        }, logger)
    };
    bsgCategories[id].normalizedName = normalizeName(bsgCategories[id].locale.en.name);
    bsgCategories[id].enumName = catNameToEnum(bsgCategories[id].locale.en.name);

    addCategory(bsgCategories[id].parent_id);
};

const addHandbookCategory = id => {
    if (!id || handbookCategories[id]) return;
    handbookCategories[id] = {
        id: id,
        name: locales.en.handbook[id],
        normalizedName: normalizeName(locales.en.handbook[id]),
        enumName: catNameToEnum(locales.en.handbook[id]),
        parent_id: null,
        child_ids: [],
        locale: getTranslations({
            name: ['handbook', id],
        }, logger),
    };

    const category = handbook.Categories.find(cat => cat.Id === id);
    const parentId = category.ParentId;
    handbookCategories[id].parent_id = parentId;
    addHandbookCategory(parentId);
};

const getTraderMultiplier = (traderId) => {
    for (const trader of traderData) {
        if (trader.id === traderId) {
            return trader.levels[0].payRate;
        }
    }
    throw error (`Trader with id ${traderId} not found in traders data`);
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

const addPropertiesToItem = (item) => {
    if (item.types.includes('preset')) return;
    if(!bsgItems[item.id]?._props){
        return;
    }

    for(const propertyKey in mappingProperties){
        if (propertyKey in bsgItems[item.id]?._props == false) {
            continue;
        }
        let propertyValue = bsgItems[item.id]._props[propertyKey];

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

    const grid = getGrid(bsgItems[item.id]);
    if(grid && grid.totalSize > 0){
        item.hasGrid = true;
    }  
};

module.exports = async () => {
    logger = new JobLogger('update-item-cache');
    try {
        logger.time('price-yesterday-query');
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
            logger.timeEnd('price-yesterday-query');
            return results;
        });

        logger.time('last-low-price-query');
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
                    timestamp > '2022-06-29 01:00:00'
                GROUP BY
                    item_id
            ) b
            ON
                a.timestamp = b.timestamp
            GROUP BY
                item_id, timestamp, price;
        `).then(results => {
            logger.timeEnd('last-low-price-query');
            return results;
        });

        let presets, globals, avgPriceYesterday, lastKnownPriceData, itemMap;
        [
            bsgItems, 
            credits, 
            locales, 
            globals, 
            traderData, 
            presets,
            avgPriceYesterday, 
            lastKnownPriceData, 
            itemMap,
            handbook,
        ] = await Promise.all([
            tarkovData.items(), 
            tarkovData.credits(),
            tarkovData.locales(),
            tarkovData.globals(),
            jobOutput('update-traders', './dumps/trader_data.json', logger),
            jobOutput('update-presets', './cache/presets.json', logger),
            avgPriceYesterdayPromise,
            lastKnownPriceDataPromise,
            remoteData.get(true),
            tarkovData.handbook(),
        ]);
        const itemData = {};
        const itemTypesSet = new Set();
        bsgCategories = {};
        initPresetSize(bsgItems, credits);

        await setItemPropertiesOptions({
            logger,
            items: bsgItems,
            presets,
            locales, 
            globals,
            itemIds: [...itemMap.keys()],
            disabledItemIds: [...itemMap.values()].filter(item => item.types.includes('disabled')).map(item => item.id)
        });
        setLocales(locales);
        for (const [key, value] of itemMap.entries()) {
            if (value.types.includes('disabled') || value.types.includes('quest'))
                continue;
            if (!bsgItems[key] && !presets[key])
                continue;

            itemData[key] = {
                ...value,
                shortName: value.short_name,
                normalizedName: value.normalized_name,
                lastOfferCount: value.last_offer_count,
                types: value.types.map(type => dashToCamelCase(type)).filter(type => type !== 'onlyFlea'),
                wikiLink: value.wiki_link,
                link: `https://tarkov.dev/item/${value.normalizedName}`,
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
            if (presets[key]) {
                itemData[key].basePrice = presets[key].baseValue;
            } else if (credits[key]) {
                itemData[key].basePrice = credits[key];
            }  else {
                logger.warn(`Unknown base value for ${itemData[key].name} ${key}`);
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
            if (bsgItems[key]) {
                addPropertiesToItem(itemData[key]);
                itemData[key].bsgCategoryId = bsgItems[key]._parent;
                itemData[key].discardLimit = bsgItems[key]._props.DiscardLimit;
                itemData[key].backgroundColor = bsgItems[key]._props.BackgroundColor;
                itemData[key].properties = await getSpecialItemProperties(bsgItems[key]);
                if (value.types.includes('gun')) {
                    itemData[key].properties.presets = Object.values(presets).filter(preset => preset.baseId === key).map(preset => preset.id);

                    const preset = Object.values(presets).find(preset => preset.default && preset.baseId === key);
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

                    const defaultSize = await getPresetSize(itemData[key], logger);
                    itemData[key].properties.defaultWidth = defaultSize.width;
                    itemData[key].properties.defaultHeight = defaultSize.height;
                    itemData[key].properties.defaultErgonomics = defaultSize.ergonomics;
                    itemData[key].properties.defaultRecoilVertical = defaultSize.verticalRecoil;
                    itemData[key].properties.defaultRecoilHorizontal = defaultSize.horizontalRecoil;
                    itemData[key].properties.defaultWeight = defaultSize.weight;
                }
                // add ammo box contents
                if (itemData[key].bsgCategoryId === '543be5cb4bdc2deb348b4568') {
                    const ammoContents = bsgItems[key]._props.StackSlots[0];
                    const count = ammoContents._max_count;
                    const round = ammoContents._props.filters[0].Filter[0];
                    itemData[key].containsItems.push({
                        item: round,
                        count: count,
                        attributes: []
                    })
                }
            } else if (presets[key]) {
                const preset = presets[key];
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
                logger.log(`Item ${itemData[key].name} (${key}) is neither an item nor a preset`);
                delete itemData[key];
                continue;
            }
            if (itemData[key].properties && !itemData[key].properties.propertiesType) {
                logger.warn(`${itemData[key].name} ${key} lacks propertiesType`);
                itemData[key].properties = null;
            }

            // add template categories
            addCategory(itemData[key].bsgCategoryId);
            const cat = bsgCategories[itemData[key].bsgCategoryId];
            if (cat) {
                itemData[key].categories.push(itemData[key].bsgCategoryId);
                let parent = bsgCategories[cat.parent_id];
                while (parent) {
                    itemData[key].categories.push(parent.id);
                    parent = bsgCategories[parent.parent_id];
                }
            }

            // add handbook categories
            const handbookItemId = itemData[key].types.includes('preset') ? itemData[key].properties.base_item_id : key;
            const handbookItem = handbook.Items.find(hbi => hbi.Id === handbookItemId);
            if (!handbookItem) {
                logger.warn(`Item ${itemData[key].name} ${key} has no handbook entry`);
            } else {
                addHandbookCategory(handbookItem.ParentId);
                let parent = handbookCategories[handbookItem.ParentId];
                while (parent) {
                    itemData[key].handbookCategories.push(parent.id);
                    parent = handbookCategories[parent.parent_id];
                }
            }

            // translations
            if (locales.en.templates[key]) { 
                itemData[key].locale = getTranslations({
                    name: ['templates', key, 'Name'],
                    shortName: ['templates', key, 'ShortName'],
                    description: ['templates', key, 'Description'],
                }, logger);
            } else if (presets[key]) {
                itemData[key].locale = {};
                for (const code in locales) {
                    itemData[key].locale[code] = presets[key].locale[code];
                }
            }

            // Add trader prices
            itemData[key].traderPrices = [];
            const currenciesNow = {
                'RUB': 1,
                'USD': credits['5696686a4bdc2da3298b456a'],
                'EUR': credits['569668774bdc2da2298b4568']
                //'USD': Math.round(credits['5696686a4bdc2da3298b456a'] * 1.1045104510451),
                //'EUR': Math.round(credits['569668774bdc2da2298b4568'] * 1.1530984204131)
            };
            const currencyId = dataMaps.currencyIsoId;
            const traderId = dataMaps.traderNameId;
            
            for (const sellCategory of itemData[key].categories) {
                if (!sellCategories[sellCategory]) {
                    continue;
                }
                for (const trader of sellCategories[sellCategory].traders) {
                    let currency = 'RUB';
                    if (trader.name === 'Peacekeeper') {
                        currency = 'USD';
                    }
                    let priceRUB = Math.floor(getTraderMultiplier(trader.id) * itemData[key].basePrice);
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
                        trader: traderId[trader.name]
                    });
                }
                break;
            }
            const ignoreCategories = [
                '543be5dd4bdc2deb348b4569', // currency
                '5448bf274bdc2dfc2f8b456a', // secure container
            ];
            if (itemData[key].traderPrices.length === 0 && !ignoreCategories.includes(itemData[key].bsgCategoryId)) {
                logger.log(`No trader sell prices mapped by category for ${itemData[key].name} (${itemData[key].id}) with category id ${itemData[key].bsgCategoryId}`);
            }

            // Map special items bought by specific vendors
            if (sellItems[key]){
                for (const trader of sellItems[key].traders){
                    let currency = 'RUB';
                    if (trader.name === 'Peacekeeper') {
                        currency = 'USD';
                    }
                    itemData[key].traderPrices.push({
                        name: trader.name,
                        price: Math.round((getTraderMultiplier(trader.id) * itemData[key].basePrice) / currenciesNow[currency]),
                        currency: currency,
                        currencyItem: currencyId[currency],
                        priceRUB: Math.floor(getTraderMultiplier(trader.id) * itemData[key].basePrice),
                        trader: traderId[trader.name]
                    });
                }
            }

            itemData[key].types.forEach(itemType => {
                itemTypesSet.add(itemType);
            });
        }

        // populate child ids for tempalte categories
        Object.values(bsgCategories).forEach(cat => {
            bsgCategories[cat.parent_id]?.child_ids.push(cat.id);
        });
        
        // populate child ids for handbook categories
        Object.values(handbookCategories).forEach(cat => {
            handbookCategories[cat.parent_id]?.child_ids.push(cat.id);
        });

        const slotIds = [];

        for (const id in bsgItems) {
            if (!bsgItems[id] || !bsgItems[id]._props.Slots) {
                continue;
            }
            bsgItems[id]._props.Slots.forEach(slot => {
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
            bsgItems[id]._props.ConflictingItems.forEach(conId => {                
                if (itemData[conId]) {
                    item.conflictingItems.push(conId);
                } else if (slotIds.includes(conId)) {
                    item.conflictingSlotIds.push(conId);
                } else if (bsgCategories[conId]) {
                    item.conflictingCategories.push(conId);
                } else if (bsgItems[id]) {
                    //logger.log(`${conId} is probably disabled`);
                } else {
                    logger.log(`${item.name} ${item.id} could not categorize conflicting item id ${conId}`);
                }
            });
        }

        const fleaData = {
            name: 'Flea Market',
            normalizedName: 'flea-market',
            minPlayerLevel: globals.config.RagFair.minUserLevel,
            enabled: globals.config.RagFair.enabled,
            sellOfferFeeRate: (globals.config.RagFair.communityItemTax / 100),
            sellRequirementFeeRate: (globals.config.RagFair.communityRequirementTax / 100),
            reputationLevels: [],
            locale: getTranslations({name: lang => {
                return lang.interface['RAG FAIR'].replace(/(?<!^|\s)\p{Lu}/gu, substr => {
                    return substr.toLowerCase();
                });
            }}, logger),
        };
        for (const offerCount of globals.config.RagFair.maxActiveOfferCount) {
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
        for (const armorTypeId in globals.config.ArmorMaterials) {
            const armorType = globals.config.ArmorMaterials[armorTypeId];
            armorData[armorTypeId] = {
                id: armorTypeId,
                name: locales.en.interface['Mat'+armorTypeId],
                locale: getTranslations({name: ['interface', `Mat${armorTypeId}`]}, logger),
            };
            for (const key in armorType) {
                armorData[armorTypeId][key.charAt(0).toLocaleLowerCase()+key.slice(1)] = armorType[key];
            }
        }

        const levelData = [];
        let currentLevel = 1;
        for (const level of globals.config.exp.level.exp_table) {
            levelData.push({
                level: currentLevel++,
                exp: level.exp
            });
        }

        const itemsData = {
            updated: new Date(),
            data: itemData,
            categories: bsgCategories,
            handbookCategories: handbookCategories,
            types: ['any', ...itemTypesSet].sort(),
            flea: fleaData,
            armorMats: armorData,
            playerLevels: levelData,
            languageCodes: Object.keys(locales).sort()
        };
        let response = await cloudflare.put('item_data', JSON.stringify(itemsData)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of item_data');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                logger.error(response.messages[i]);
            }
        }

        // Possibility to POST to a Discord webhook here with cron status details.
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    await jobComplete();
    logger.end();
    bsgItems = credits = locales = bsgCategories = logger = false;
};
