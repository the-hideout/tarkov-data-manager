const fs = require('fs');
const path = require('path');

const roundTo = require('round-to');

const cloudflare = require('../modules/cloudflare');
const remoteData = require('../modules/remote-data');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');

let bsgItems = false;
let en = false;
const bsgCategories = {};

const ignoreCategories = [
    '54009119af1c881c07000029', // Item
    '566162e44bdc2d3f298b4573', // Compound item
    '5661632d4bdc2d903d8b456b', // Stackable item
    '566168634bdc2d144c8b456c', // Searchable item
];

const availableProperties = [
    'weight',
    'velocity',
    'loudness',
];

const addCategory = id => {
    if (!id || bsgCategories[id]) return;
    bsgCategories[id] = {
        id: id,
        parent_id: null
    };
    if (en.templates[id]) {
        bsgCategories[id].name = en.templates[id].Name
    } else {
        bsgCategories[id].name = bsgItems[id]._name;
    }
    const parentId = bsgItems[id]._parent;
    if (!ignoreCategories.includes(parentId)) {
        bsgCategories[id].parent_id = parentId;
        addCategory(parentId);
    }
};

const camelCase = input => {
    return input.toLowerCase().replace(/-(.)/g, function(match, group1) {
        return group1.toUpperCase();
    });
};

module.exports = async () => {
    const logger = new JobLogger('update-cache');
    try {
        bsgItems = await tarkovChanges.items();
        en = await tarkovChanges.locale_en();
        const globals = await tarkovChanges.globals();
        const itemMap = await remoteData.get(true);
        const itemData = {};

        logger.time('price-yesterday-query');
        const avgPriceYesterday = await query(`SELECT
            avg(price) AS priceYesterday,
            item_id
        FROM
            price_data
        WHERE
            timestamp > DATE_SUB(NOW(), INTERVAL 2 DAY)
        AND
            timestamp < DATE_SUB(NOW(), INTERVAL 1 DAY)
        GROUP BY
            item_id`);
        logger.timeEnd('price-yesterday-query');

        logger.time('last-low-price-query');
        const lastKnownPriceData = await query(`SELECT
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
                timestamp > '2021-12-12 01:00:00'
            GROUP BY
                item_id
        ) b
        ON
            a.timestamp = b.timestamp
        GROUP BY
            item_id, timestamp, price;`);
        logger.timeEnd('last-low-price-query');

        logger.time('contained-items-query');
        const containedItems = await query(`SELECT
            *
        FROM
            item_children;`);
        logger.timeEnd('contained-items-query');

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

        for (const [key, value] of itemMap.entries()) {
            itemData[key] = value;

            Reflect.deleteProperty(itemData[key], 'last_update');
            Reflect.deleteProperty(itemData[key], 'last_scan');
            Reflect.deleteProperty(itemData[key], 'checked_out_by');
            Reflect.deleteProperty(itemData[key], 'trader_last_scan');
            Reflect.deleteProperty(itemData[key], 'trader_checked_out_by');
            Reflect.deleteProperty(itemData[key], 'scan_position');
            Reflect.deleteProperty(itemData[key], 'match_index');

            // Only add these if it's allowed on the flea market
            if (!itemData[key].types.includes('no-flea')) {
                let itemPriceYesterday = avgPriceYesterday.find(row => row.item_id === key);

                if (!itemPriceYesterday || itemData[key].avg24hPrice === 0) {
                    itemData[key].changeLast48hPercent = 0;
                } else {
                    const percentOfDayBefore = itemData[key].avg24hPrice / itemPriceYesterday.priceYesterday
                    itemData[key].changeLast48hPercent = roundTo((percentOfDayBefore - 1) * 100, 2);
                }
                itemData[key].changeLast48h = itemData[key].changeLast48hPercent

                if (!itemData[key].lastLowPrice) {
                    let lastKnownPrice = lastKnownPriceData.find(row => row.item_id === key);
                    if (lastKnownPrice) {
                        itemData[key].updated = lastKnownPrice.timestamp;
                        itemData[key].lastLowPrice = lastKnownPrice.price;
                    }
                }
            }

            itemData[key].types = itemData[key].types.map(type => camelCase(type));

            itemData[key].containsItems = containedItemsMap[key];

            // itemData[key].changeLast48h = itemPriceYesterday.priceYesterday || 0;

            if (itemData[key].properties) {
                addCategory(itemData[key].properties.bsgCategoryId);

                if(itemData[key].properties.accuracy){
                    itemData[key].accuracyModifier = Number(itemData[key].properties.accuracy);
                }
    
                if(itemData[key].properties.recoil){
                    itemData[key].recoilModifier = Number(itemData[key].properties.recoil);
                }
    
                if(itemData[key].properties.ergonomics){
                    itemData[key].ergonomicsModifier = Number(itemData[key].properties.ergonomics);
                }
    
                if(itemData[key].properties.grid && itemData[key].properties.grid.totalSize > 0){
                    itemData[key].hasGrid = true;
                }
    
                if(itemData[key].properties.blocksEarpiece){
                    itemData[key].blocksHeadphones = true;
                }
    
                if(itemData[key].properties.bsgCategoryId){
                    itemData[key].bsgCategoryId = itemData[key].properties.bsgCategoryId;
                }

                for(const availableProperty of availableProperties){
                    if(typeof itemData[key].properties[availableProperty] !== 'undefined'){
                        itemData[key][availableProperty] = Number(itemData[key].properties[availableProperty]);
                    }
                }
            }

            itemData[key].iconLink = itemData[key].icon_link;
            itemData[key].gridImageLink = itemData[key].grid_image_link;
            itemData[key].imageLink = itemData[key].image_link;
            itemData[key].basePrice = itemData[key].base_price;
            itemData[key].shortName = itemData[key].shortname;
            itemData[key].wikiLink = itemData[key].wiki_link;
            itemData[key].normalizedName = itemData[key].normalized_name;
            itemData[key].link = `https://tarkov.dev/item/${itemData[key].normalizedName}`;

            itemData[key].discardLimit = -1;
            if (bsgItems[key]) {
                itemData[key].bsgCategoryId = bsgItems[key]._parent;
                itemData[key].discardLimit = bsgItems[key]._props.DiscardLimit;
            }

            // Fallback images
            itemData[key].imageLinkFallback = itemData[key].imageLink || 'https://assets.tarkov.dev/unknown-item-image.jpg';
            itemData[key].iconLinkFallback = itemData[key].iconLink || 'https://assets.tarkov.dev/unknown-item-icon.jpg';
            itemData[key].gridImageLinkFallback = itemData[key].gridImageLink || 'https://assets.tarkov.dev/unknown-item-grid-image.jpg';

            itemData[key].imageLink = itemData[key].imageLink || itemData[key].imageLinkFallback;
            itemData[key].iconLink = itemData[key].iconLink || itemData[key].iconLinkFallback;
            itemData[key].gridImageLink = itemData[key].gridImageLink || itemData[key].gridImageLinkFallback;
        }

        const fleaData = {
            name: 'Flea Market',
            minPlayerLevel: globals.config.RagFair.minUserLevel,
            enabled: globals.config.RagFair.enabled,
            sellOfferFeeRate: (globals.config.RagFair.communityItemTax / 100),
            sellRequirementFeeRate: (globals.config.RagFair.communityRequirementTax / 100),
            reputationLevels: []
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

        const items = {
            updated: new Date(),
            data: itemData,
            categories: bsgCategories,
            flea: fleaData
        };
        const response = await cloudflare(`/values/ITEM_CACHE_V2`, 'PUT', JSON.stringify(items)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of ITEM_CACHE');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                logger.error(response.messages[i]);
            }
        }
        fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'item-cache.json'), JSON.stringify(items, null, 4));

        // Possibility to POST to a Discord webhook here with cron status details
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    await jobComplete();
    logger.end();
};