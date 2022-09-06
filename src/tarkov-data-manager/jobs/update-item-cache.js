const fs = require('fs/promises');

const roundTo = require('round-to');

const dataMaps = require('../modules/data-map');
const {categories, items} = require('../modules/category-map');
const cloudflare = require('../modules/cloudflare');
const remoteData = require('../modules/remote-data');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');
const jobOutput = require('../modules/job-output');
const {dashToCamelCase} = require('../modules/string-functions');
const { setItemPropertiesOptions, getSpecialItemProperties, topCategories } = require('../modules/get-item-properties');
const { initPresetSize, getPresetSize } = require('../modules/preset-size');
const normalizeName = require('../modules/normalize-name');

let bsgItems = false;
let credits = false;
let locales = false;
let traderData = false;
let logger = false;
let bsgCategories = {};

const catNameToEnum = (sentence) => {
    return sentence.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g,
    function(word, i) {
       if (+word === 0)
          return '';
       return i === 0 ? word :
       word.toUpperCase();
    }).replace(/\.+/g, '');
};

const addCategory = id => {
    if (!id || bsgCategories[id]) return;
    bsgCategories[id] = {
        id: id,
        parent_id: null,
        child_ids: [],
        locale: {}
    };
    if (locales.en.templates[id]) {
        bsgCategories[id].name = locales.en.templates[id].Name
        bsgCategories[id].normalizedName = normalizeName(locales.en.templates[id].Name);
    } else {
        bsgCategories[id].name = bsgItems[id]._name;
        bsgCategories[id].normalizedName = normalizeName(bsgItems[id]._name);
    }
    bsgCategories[id].enumName = catNameToEnum(bsgCategories[id].name);
    for (const code in locales) {
        const lang = locales[code];
        if (lang.templates[id]) {
            bsgCategories[id].locale[code] = {
                name: lang.templates[id].Name
            };
        } else {
            bsgCategories[id].locale[code] = {
                name: bsgItems[id]._name
            };
        }
    }
    const parentId = bsgItems[id]._parent;
    //if (!topCategories.includes(parentId)) {
        bsgCategories[id].parent_id = parentId;
        addCategory(parentId);
    //}
};

const getTraderMultiplier = (traderId) => {
    for (const trader of traderData) {
        if (trader.id === traderId) {
            return trader.levels[0].payRate;
        }
    }
    throw error (`Trader with id ${traderId} not found in traders data`);
};

const getItemCategory = (id, original) => {
    if (!original) original = id;
    if(!id){
        return original;
    }

    // Check if parent is category
    if(categories[id]){
        return id;
    }

    // Let's traverse
    return getItemCategory(bsgItems[id]._parent, original);
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

        logger.time('contained-items-query');
        const containedItemsPromise = query(`
            SELECT
                *
            FROM
                item_children;
        `).then (results => {
            logger.timeEnd('contained-items-query');
            return results;
        });

        let presets, globals, avgPriceYesterday, lastKnownPriceData, containedItems, itemMap;
        [
            bsgItems, 
            credits, 
            locales, 
            globals, 
            traderData, 
            presets,
            avgPriceYesterday, 
            lastKnownPriceData, 
            containedItems, 
            itemMap
        ] = await Promise.all([
            tarkovChanges.items(), 
            tarkovChanges.credits(),
            tarkovChanges.locales(),
            tarkovChanges.globals(),
            jobOutput('update-traders', './dumps/trader_data.json', logger),
            jobOutput('update-presets', './cache/presets.json', logger),
            avgPriceYesterdayPromise,
            lastKnownPriceDataPromise,
            containedItemsPromise,
            remoteData.get(true)
        ]);
        const itemData = {};
        const itemTypesSet = new Set();
        bsgCategories = {};
        initPresetSize(bsgItems, credits);

        let containedItemsMap = {};

        for (const result of containedItems) {
            if (!containedItemsMap[result.container_item_id]) {
                containedItemsMap[result.container_item_id] = [];
            }

            containedItemsMap[result.container_item_id].push({
                item: result.child_item_id,
                count: result.count,
                attributes: []
            });
        }

        await setItemPropertiesOptions({
            logger,
            items: bsgItems,
            locales, 
            globals,
            itemIds: [...itemMap.keys()],
            disabledItemIds: [...itemMap.values()].filter(item => item.types.includes('disabled')).map(item => item.id)
        });
        for (const [key, value] of itemMap.entries()) {
            if (value.types.includes('disabled')) continue;
            if (!bsgItems[key] && !presets[key]) continue;
            itemData[key] = {
                ...value,
                shortName: value.short_name,
                normalizedName: value.normalized_name,
                lastOfferCount: value.last_offer_count
            };

            Reflect.deleteProperty(itemData[key], 'last_update');
            Reflect.deleteProperty(itemData[key], 'last_scan');
            Reflect.deleteProperty(itemData[key], 'trader_last_scan');
            Reflect.deleteProperty(itemData[key], 'checkout_scanner_id');
            Reflect.deleteProperty(itemData[key], 'trader_checkout_scanner_id');
            Reflect.deleteProperty(itemData[key], 'scan_position');
            Reflect.deleteProperty(itemData[key], 'match_index');
            Reflect.deleteProperty(itemData[key], 'normalized_name');
            Reflect.deleteProperty(itemData[key], 'short_name');
            Reflect.deleteProperty(itemData[key], 'disabled');
            Reflect.deleteProperty(itemData[key], 'last_offer_count');


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

            itemData[key].types = itemData[key].types.map(type => dashToCamelCase(type));

            itemData[key].containsItems = containedItemsMap[key] || [];

            // itemData[key].changeLast48h = itemPriceYesterday.priceYesterday || 0;

            // add item properties
            itemData[key].discardLimit = -1;
            itemData[key].basePrice = 0;
            if (bsgItems[key]) {
                addPropertiesToItem(itemData[key]);
                itemData[key].bsgCategoryId = bsgItems[key]._parent;
                itemData[key].discardLimit = bsgItems[key]._props.DiscardLimit;
                itemData[key].backgroundColor = bsgItems[key]._props.BackgroundColor;
                itemData[key].properties = await getSpecialItemProperties(bsgItems[key], bsgItems[bsgItems[key]._parent]);
                if (value.types.includes('gun')) {
                    const defaultSize = await getPresetSize(itemData[key], logger);
                    itemData[key].properties.defaultWidth = defaultSize.width;
                    itemData[key].properties.defaultHeight = defaultSize.height;
                    itemData[key].properties.defaultErgonomics = defaultSize.ergonomics;
                    itemData[key].properties.defaultRecoilVertical = defaultSize.verticalRecoil;
                    itemData[key].properties.defaultRecoilHorizontal = defaultSize.horizontalRecoil;
                    itemData[key].properties.defaultWeight = defaultSize.weight;
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
                    recoilHorizontal: preset.horizontalRecoil
                };
                if ((itemData[preset.baseId]?.types.includes('noFlea') || itemData[preset.baseId]?.types.includes('no-flea')) && !itemData[key].types.includes('noFlea')) {
                    itemData[key].types.push('noFlea');
                }
            } else if (!itemData[key].types.includes('disabled')) {
                logger.log(`Item ${itemData[key].name} (${key}) is neither an item nor a preset`);
                delete itemData[key];
                continue;
            }
            addCategory(itemData[key].bsgCategoryId);
            if (presets[key]) {
                itemData[key].basePrice = presets[key].baseValue;
            } else if (credits[key]) {
                itemData[key].basePrice = credits[key];
            } 

            itemData[key].iconLink = itemData[key].icon_link;
            itemData[key].gridImageLink = itemData[key].grid_image_link;
            itemData[key].imageLink = itemData[key].image_link;
            //itemData[key].shortName = itemData[key].shortname;
            itemData[key].wikiLink = itemData[key].wiki_link;
            itemData[key].link = `https://tarkov.dev/item/${itemData[key].normalizedName}`;
            Reflect.deleteProperty(itemData[key], 'icon_link');
            Reflect.deleteProperty(itemData[key], 'grid_image_link');
            Reflect.deleteProperty(itemData[key], 'image_link');
            Reflect.deleteProperty(itemData[key], 'wiki_link');

            // Fallback images
            itemData[key].inspectImageLinkFallback = itemData[key].imageLink || 'https://assets.tarkov.dev/unknown-item-image.jpg';
            itemData[key].iconLinkFallback = itemData[key].iconLink || 'https://assets.tarkov.dev/unknown-item-icon.jpg';
            itemData[key].gridImageLinkFallback = itemData[key].gridImageLink || 'https://assets.tarkov.dev/unknown-item-grid-image.jpg';

            itemData[key].inspectImageLink = itemData[key].imageLink || itemData[key].inspectImageLinkFallback;
            itemData[key].iconLink = itemData[key].iconLink || itemData[key].iconLinkFallback;
            itemData[key].gridImageLink = itemData[key].gridImageLink || itemData[key].gridImageLinkFallback;

            // translations
            itemData[key].locale = {};
            for (const code in locales) {
                const lang = locales[code];
                if (lang.templates[key]) {
                    itemData[key].locale[code] = {
                        name: lang.templates[key].Name,
                        shortName: lang.templates[key].ShortName
                    };
                } else if (presets[key]) {
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
            
            let sellCategory = getItemCategory(itemData[key].bsgCategoryId);
            if (!sellCategory && !itemData[key].types.includes('disabled')) {
                logger.log(`No category found for ${itemData[key].name} (${key})`);
            }
            if (sellCategory && categories[sellCategory]){
                for(const trader of categories[sellCategory].traders){
                    let currency = 'RUB';
                    if (trader.name === 'Peacekeeper') currency = 'USD';
                    let priceRUB = Math.floor(getTraderMultiplier(trader.id) * itemData[key].basePrice);
                    const priceCUR = Math.round(priceRUB / currenciesNow[currency]);
                    if (priceCUR === 0) priceRUB = 0;
                    itemData[key].traderPrices.push({
                        name: trader.name,
                        price: priceCUR,
                        currency: currency,
                        currencyItem: currencyId[currency],
                        priceRUB: priceRUB,
                        trader: traderId[trader.name]
                    });
                }
            } else {
                if (itemData[key].types && !itemData[key].types.includes('disabled')) {
                    logger.log(`No category for trader prices mapped for ${itemData[key].name} (${itemData[key].id}) with category id ${itemData[key].bsgCategoryId}`);
                }
            }

            // Map special items bought by specific vendors
            if(items[key]){
                for(const trader of items[key].traders){
                    let currency = 'RUB';
                    if (trader.name === 'Peacekeeper') currency = 'USD';
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

        // populate categories attribute with all categories up the tree
        for (const id in itemData) {
            const item = itemData[id];
            item.categories = [];
            const cat = bsgCategories[item.bsgCategoryId];
            if (!cat) continue;
            item.categories.push(item.bsgCategoryId);
            if (!bsgCategories[cat.parent_id]) continue;
            let parent = bsgCategories[cat.parent_id];
            while (parent) {
                item.categories.push(parent.id);
                parent = bsgCategories[parent.parent_id];
            }
        }

        Object.values(bsgCategories).forEach(cat => {
            bsgCategories[cat.parent_id]?.child_ids.push(cat.id);
        });

        const fleaData = {
            name: 'Flea Market',
            normalizedName: 'flea-market',
            minPlayerLevel: globals.config.RagFair.minUserLevel,
            enabled: globals.config.RagFair.enabled,
            sellOfferFeeRate: (globals.config.RagFair.communityItemTax / 100),
            sellRequirementFeeRate: (globals.config.RagFair.communityRequirementTax / 100),
            reputationLevels: [],
            locale: {}
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
        for (const code in locales) {
            const lang = locales[code];
            if (lang.interface['RAG FAIR']) {
                fleaData.locale[code] = {
                    name: lang.interface['RAG FAIR'].replace(/(?<!^|\s)\p{Lu}/gu, substr => {
                        return substr.toLowerCase();
                    })
                };
            }
        }

        const armorData = {};
        for (const armorTypeId in globals.config.ArmorMaterials) {
            const armorType = globals.config.ArmorMaterials[armorTypeId];
            armorData[armorTypeId] = {
                id: armorTypeId,
                name: locales.en.interface['Mat'+armorTypeId],
                locale: {}
            };
            for (const key in armorType) {
                armorData[armorTypeId][key.charAt(0).toLocaleLowerCase()+key.slice(1)] = armorType[key];
            }
            armorData[armorTypeId].name = locales.en.interface['Mat'+armorTypeId];
            for (const code in locales) {
                const lang = locales[code];
                if (lang.interface['Mat'+armorTypeId]) {
                    armorData[armorTypeId].locale[code] = {
                        name: lang.interface['Mat'+armorTypeId]
                    };
                }
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
