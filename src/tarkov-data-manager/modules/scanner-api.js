const fs = require('fs');
const path = require('path');
const formidable = require('formidable');

const { query } = require('./db-connection');
const { dashToCamelCase } = require('./string-functions');
const remoteData = require('./remote-data');
const { uploadToS3 } = require('./upload-s3');
const { createAndUploadFromSource } = require('./image-create');
const { imageFunctions } = require('tarkov-dev-image-generator');

const { imageSizes } = imageFunctions;

let refreshingUsers = false;
let users = {};
let presets = {};
let presetsTimeout = false;

const dogtags = [
    '59f32bb586f774757e1e8442',
    '59f32c3b86f77472a31742f0',
];

const isDogtag = (id) => {
    return dogtags.includes(id);
};

const updatePresets = () => {
    try {
        const fileContents = fs.readFileSync(path.join(__dirname, '..', 'cache', 'presets.json'));
        presets = JSON.parse(fileContents.presets);
    } catch (error) {
        console.log('ScannerAPI error reading presets.json:', error.message);
    }
};

fs.watch(path.join(__dirname, '..', 'cache'), {persistent: false}, (eventType, filename) => {
    if (filename === 'presets.json') {
        clearTimeout(presetsTimeout);
        presetsTimeout = setTimeout(updatePresets, 100);
        
    }
});

updatePresets();

// sets defaults for various options used by API calls
// limitItem is a single item or array of items to specifically retrieve (generally for testing)
// imageOnly = true will retrieve only items missing images
// batchSize sets the number of items to retrieve at once
// offersFrom indicates whether the scanner is scanning player prices, trader prices, or both
// limitTrderScan = true ensures that a new batch of trader items to scan is only returned if there are some items
//      missing a trader scan within the past 24 hours
// trustTraderUnlocks = true means the information provided about trader minimum levels and quests will be used
//      to create missing trader offers.
// scanned is a toggle to indicate whether to set an item as scanned or release it
const getOptions = (options, user) => {
    const defaultOptions = {
        limitItem: false,
        imageOnly: false,
        batchSize: 50,
        offersFrom: 2,
        limitTraderScan: true,
        trustTraderUnlocks: false,
        scanned: false,
        offerCount: undefined
    }
    const mergedOptions = {
        ...defaultOptions,
        ...options,
        user: user
    };
    if (mergedOptions.batchSize > 200) {
        mergedOptions.batchSize = 200;
    }
    if (mergedOptions.limitItem && typeof mergedOptions.limitItem === 'string') {
        mergedOptions.limitItem = [mergedOptions.limitItem];
    } else if (!mergedOptions.limitItem) {
        mergedOptions.limitItem = false;
    }
    const offerMap = {
        'any': 0,
        'traders': 1,
        'players': 2
    }
    if (typeof mergedOptions.offersFrom === 'string') {
        if (offerMap[mergedOptions.offersFrom]) {
            mergedOptions.offersFrom = offerMap[mergedOptions.offersFrom];
        } else {
            mergedOptions.offersFrom = 2;
        }
    }
    return mergedOptions;
};

const queryResultToBatchItem = item => {
    const types = item.types ? item.types.split(',').map(dashCase => {return dashToCamelCase(dashCase);}) : [];
    let contains = item.contains ? item.contains.split(',') : [];
    let itemPresets = [];
    if (types.includes('gun')) {
        itemPresets = presets.presets.filter(testPreset => testPreset.baseId === item.id).map(preset => {
            if (preset.default) {
                contains = preset.containsItems.reduce((parts, currentItem) => {
                    parts.push({
                        id: currentItem.item.id,
                        name: presets.locale.en[currentItem.item.name],
                        count: currentItem.count,
                    });
                    return parts;
                }, []);
            }
            return {
                id: preset.id,
                name: preset.name,
                shortName: preset.shortName,
                types: preset.types,
                backgroundColor: preset.backgroundColor,
                width: preset.width,
                height: preset.height,
                default: preset.default,
                contains: preset.containsItems.reduce((parts, currentItem) => {
                    parts.push({
                        id: currentItem.item.id,
                        name: currentItem.item.name,
                        count: currentItem.count,
                    });
                    return parts;
                }, [])
            }
        });
    } else if (types.includes('preset')) {
        const matchedPreset = presets.presets.find(preset => preset.id === item.id);
        if (matchedPreset) {
            contains = matchedPreset.map(contained => contained.item.id);
        }
    }
    const backgroundColor = item.properties?.backgroundColor ? item.properties.backgroundColor : 'default';
    return {
        id: item.id,
        name: String(item.name),
        shortName: String(item.short_name),
        types: types,
        backgroundColor: backgroundColor,
        width: item.width ? item.width : 1,
        height: item.height ? item.height : 1,
        contains: contains,
        matchIndex: item.match_index,
        needsBaseImage: item.needs_base_image ? true : false,
        needsImage: item.needs_image ? true : false,
        needsGridImage: item.needs_grid_image ? true : false,
        needsIconImage: item.needs_icon_image ? true : false,
        needs512pxImage: item.needs_512px_image ? true : false,
        needs8xImage: item.needs_8x_image ? true : false,
        presets: itemPresets,
        // Backwards compatibility
        /*short_name: String(item.short_name),
        needs_base_image: existingBaseImages.length > 0 && !existingBaseImages.includes(item.id),
        needs_image: item.needs_image ? true : false,
        needs_grid_image: item.needs_grid_image ? true : false,
        needs_icon_image: item.needs_icon_image ? true : false*/
    };
};

/* on success, response.data is an array of items with the following format:
{
    id: '57dc2fa62459775949412633',
    name: 'Kalashnikov AKS-74U 5.45x39 assault rifle',
    shortName: 'AKS-74U',
    matchIndex: 0,
    backgroundColor: 'black',
    needsBaseImage: false,
    needsImage: false,
    needsGridImage: false,
    needsIconImage: false,
    needs512pxImage: false,
    needs8xImage: false,
    types: [ 'gun', 'wearable' ],
    contains: [
        '564ca99c4bdc2d16268b4589',
        '57dc324a24597759501edc20',
        '57dc32dc245977596d4ef3d3',
        '57dc334d245977597164366f',
        '57dc347d245977596754e7a1',
        '57e3dba62459770f0c32322b',
        '59d36a0086f7747e673f3946'
    ]
} */
// relevant options: limitItem, imageOnly, batchSize, offersFrom, limitTraderScan
const getItems = async(options) => {
    const user = options.user;
    const response = {errors: [], warnings: [], data: []};
    try {
        if (options.limitItem) {
            let itemIds = options.limitItem;
            if (!Array.isArray(itemIds)) {
                itemIds = [itemIds];
            }
            response.data = await query(`
                SELECT
                    item_data.id,
                    name,
                    short_name,
                    match_index,
                    width,
                    height,
                    properties,
                    image_link IS NULL OR image_link = '' AS needs_image,
                    base_image_link IS NULL OR base_image_link = '' as needs_base_image,
                    grid_image_link IS NULL OR grid_image_link = '' AS needs_grid_image,
                    icon_link IS NULL OR icon_link = '' AS needs_icon_image,
                    image_512_link IS NULL or image_512_link = '' as needs_512px_image,
                    image_8x_link IS NULL or image_8x_link = '' as needs_8x_image,
                    GROUP_CONCAT(DISTINCT types.type SEPARATOR ',') AS types
                FROM
                    item_data
                LEFT JOIN types ON
                    types.item_id = item_data.id
                WHERE 
                    item_data.id IN (${itemIds.map(() => '?').join(',')})
                GROUP BY
                    item_data.id
            `, itemIds).then(items => items.map(queryResultToBatchItem));
            return response;
        }
        if (options.imageOnly) {
            response.data = await query(`
                SELECT
                    item_data.id,
                    name,
                    short_name,
                    match_index,
                    width,
                    height,
                    properties,
                    image_link IS NULL OR image_link = '' AS needs_image,
                    base_image_link IS NULL OR base_image_link = '' as needs_base_image,
                    grid_image_link IS NULL OR grid_image_link = '' AS needs_grid_image,
                    icon_link IS NULL OR icon_link = '' AS needs_icon_image,
                    image_512_link IS NULL or image_512_link = '' as needs_512px_image,
                    image_8x_link IS NULL or image_8x_link = '' as needs_8x_image,
                    GROUP_CONCAT(DISTINCT types.type SEPARATOR ',') AS types
                FROM
                    item_data
                LEFT JOIN types ON
                    types.item_id = item_data.id
                WHERE NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'disabled') AND 
                    NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'preset') AND 
                    NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'quest') AND 
                    (item_data.image_link IS NULL OR item_data.image_link = '' OR 
                    item_data.base_image_link IS NULL OR item_data.base_image_link = '' OR 
                    item_data.grid_image_link IS NULL OR item_data.grid_image_link = '' OR 
                    item_data.icon_link IS NULL OR item_data.icon_link = '' OR
                    item_data.image_512_link IS NULL or item_data.image_512_link = '' OR 
                    item_data.image_8x_link IS NULL or item_data.image_8x_link = '')
                GROUP BY item_data.id
                ORDER BY item_data.name
            `).then(items => {
                return items.filter(item => Boolean(item.name)).map(queryResultToBatchItem);
            });
            return response;
        }
    
        let conditions = [];
        if (options.offersFrom == 2 || options.offersFrom == 0) {
            // if just players, exclude no-flea
            let nofleaCondition = '';
            if (options.offersFrom == 2) {
                nofleaCondition = 'AND NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = \'no-flea\')';
            }
            // player price checkout
            // works if we include trader prices too
            await query(`
                UPDATE item_data
                SET checkout_scanner_id = ?
                WHERE (checkout_scanner_id IS NULL OR checkout_scanner_id = ?) AND
                    NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'disabled') AND 
                    NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'preset') AND 
                    NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'quest') ${nofleaCondition} 
                ORDER BY last_scan, id
                LIMIT ?
            `, [options.scanner.id,options.scanner.id,options.batchSize]);
    
            conditions.push('item_data.checkout_scanner_id = ?');
        } else {
            // trader-only price checkout
            const params = [options.scanner.id, options.scanner.id];
            let lastScanCondition = '';
            if (options.limitTraderScan) {
                const traderScanSession = await startTraderScan(options);
                lastScanCondition = 'AND (trader_last_scan <= ? OR trader_last_scan IS NULL)';
                params.push(traderScanSession.data.started);
            }
            params.push(options.batchSize);
            await query(`
                UPDATE item_data
                SET trader_checkout_scanner_id = ?
                WHERE ((trader_checkout_scanner_id IS NULL OR trader_checkout_scanner_id = ?) AND 
                    NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'disabled') AND 
                    NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'preset') AND 
                    NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'only-flea') AND 
                    NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'quest') ${lastScanCondition} )
                ORDER BY trader_last_scan, id
                LIMIT ?
            `, params);
    
            conditions.push('item_data.trader_checkout_scanner_id = ?');
        }
    
        let where = '';
        if (conditions.length > 0) {
            where = `WHERE ${conditions.join(' AND ')}`;
        }
        response.data = await query(`
            SELECT
                item_data.id,
                name,
                short_name,
                match_index,
                properties,
                image_link IS NULL OR image_link = '' AS needs_image,
                base_image_link IS NULL OR base_image_link = '' as needs_base_image,
                grid_image_link IS NULL OR grid_image_link = '' AS needs_grid_image,
                icon_link IS NULL OR icon_link = '' AS needs_icon_image,
                image_512_link IS NULL or image_512_link = '' as needs_512px_image,
                image_8x_link IS NULL or image_8x_link = '' as needs_8x_image,
                GROUP_CONCAT(DISTINCT types.type SEPARATOR ',') AS types
            FROM
                item_data
            LEFT JOIN types ON
                types.item_id = item_data.id
            ${where}
            GROUP BY item_data.id
            ORDER BY item_data.last_scan
        `, [options.scanner.id]).then(items => {
            return items.filter(item => Boolean(item.name)).map(queryResultToBatchItem);
        });
        if (response.data.length === 0 && options.offersFrom === 1 && options.limitTraderScan) {
            await endTraderScan();
        }
    } catch (error) {
        response.errors.push(String(error));
    }
    if (userFlags.skipPriceInsert & user.flags || scannerFlags.skipPriceInsert & options.scanner.flags) {
        releaseItem({...options, itemId: false, scanned: false});
    }
    return response;
};

//on success, response.data is an array with the first element being the number of player prices inserted
//and the second element being the number of trader prices inserted
// requires options itemId, itemPrices, and offersFrom
// also uses trustTraderUnlocks optionally
// if offerCount is set, that will also be used for setting the item as scanned
/*the itemPrices option is an array of objects with the following structure:
[
    {
        seller: 'Player',
        currency: 'RUB',
        quest: null,
        minLevel: null,
        price: 9876
    },
    {
        seller: 'Peacekeeper',
        currency: 'USD',
        quest: 42,
        minLevel: null,
        price: 1234
    },
    {
        seller: 'Mechanic',
        currency: 'EUR',
        quest: null,
        minLevel: 3,
        price: 5678
    }
]
quest and minLevel are only used for trader prices.
If the trader price is locked and neither of these values is known, they should be null
*/
const insertPrices = async (options) => {
    const user = options.user;
    let scanFlags = options.scanner.flags;
    const skipInsert = userFlags.skipPriceInsert & user.flags || scannerFlags.skipPriceInsert & scanFlags;
    const response = {errors: [], warnings: [], data: [0, 0]};
    const itemId = options.itemId;
    let itemPrices = options.itemPrices;
    if (!itemId) {
        response.errors.push('no item id specified');
    }
    if (!itemPrices){
        response.errors.push('no prices to insert');
    }
    if (!Array.isArray(itemPrices)) {
        itemPrices = [itemPrices];
    }
    if (itemPrices.length == 0) {
        response.errors.push('no prices to insert');
    }
    if (response.errors.length > 0) {
        return response;
    }
    const playerPrices = [];
    const traderPrices = [];
    for (let i = 0; i < itemPrices.length; i++) {
        // player prices are only rubles
        if (itemPrices[i].seller == 'Player' && itemPrices[i].currency == 'RUB') {
            playerPrices.push(itemPrices[i]);
        } else if (itemPrices[i].seller != 'Player') {
            traderPrices.push(itemPrices[i]);
        }
    }
    let playerInsert = Promise.resolve({affectedRows: 0});
    let traderInsert = Promise.resolve({affectedRows: 0});
    const dateTime = new Date();
    if (playerPrices.length > 0 && userFlags.insertPlayerPrices & user.flags) {
        // player prices
        const placeholders = [];
        const values = [];
        for (let i = 0; i < playerPrices.length; i++) {
            placeholders.push('(?, ?, ?, now())');
            values.push(itemId, playerPrices[i].price, options.scanner.id);
        }
        if (skipInsert) {
            response.warnings.push(`Skipped insert of ${playerPrices.length} player prices`);
        } else {
            playerInsert = query(`INSERT INTO price_data (item_id, price, scanner_id, timestamp) VALUES ${placeholders.join(', ')}`, values);
        }
    } else if (playerPrices.length > 0) {
        playerInsert = Promise.reject(new Error('User not authorized to insert player prices'));
    }
    if (traderPrices.length > 0 && userFlags.insertTraderPrices & user.flags) { 
        // trader prices
        //const traderPriceInserts = [];
        const placeholders = [];
        const traderValues = [];
        for (let i = 0; i < traderPrices.length; i++) {
            const tPrice = traderPrices[i];
            let offerId = false;
            const offerTest = await query(`
                SELECT id, currency, min_level, quest_unlock_id, quest_unlock_bsg_id FROM trader_items
                WHERE item_id=? AND trader_name=?
            `, [itemId, tPrice.seller.toLowerCase()]);
            if (offerTest.length > 0) {
                // offer exists
                if (options.trustTraderUnlocks && userFlags.trustTraderUnlocks & user.flags) {
                    // can trust scanner min level & quest
                    // attempt to match
                    const matchedOffers = [];
                    for (const offer of offerTest) {
                        if (
                            (tPrice.minLevel === null || offer.min_level === null || offer.min_level === tPrice.minLevel) && 
                            (tPrice.quest === null || (offer.quest_unlock_id === null && offer.quest_unlock_bsg_id === null) || offer.quest_unlock_id == tPrice.quest || offer.quest_unlock_bsg_id == tPrice.quest)
                        ) {
                            matchedOffers.push(offer.id);
                        }
                    }
                    if (matchedOffers.length === 1) {
                        const matchedOffer = matchedOffers[0];
                        offerId = matchedOffer.id;
                        if (matchedOffer.min_level === null && tPrice.minLevel !== null) {
                            try {
                                await query(`
                                    UPDATE trader_items
                                    SET min_level = ?, scanner_id = ?
                                    WHERE id = ${matchedOffer.id}
                                `, [tPrice.minLevel, options.scanner.id]);
                            } catch (error) {
                                response.warnings.push(`Failed updating minimum level for trader offer ${matchedOffer.id} to ${tPrice.minLevel}: ${error}`);
                            }
                        }
                    } else if (matchedOffers.length > 1) {
                        response.warnings.push(`${tPrice.seller} had ${matchedOffers.length} matching offers for ${itemId}, skipping price insert`);
                    } else if (offerTest.length === 1) {
                        const offer = offerTest[0];
                        if (offer.min_level && tPrice.minLevel && offer.min_level !== tPrice.minLevel & options.trustTraderUnlocks && userFlags.trustTraderUnlocks & user.flags) {
                            try {
                                await query(`
                                    UPDATE trader_items
                                    SET min_level = ?, scanner_id = ?
                                    WHERE id = ${offer.id}
                                `, [tPrice.minLevel, options.scanner.id]);
                                offerId = offer.id;
                            } catch (error) {
                                response.warnings.push(`Failed updating minimum level for trader offer ${offer.id} to ${tPrice.minLevel}: ${error}`);
                            }
                        }
                    }
                } else if (offerTest.length === 1) {
                    // easy match
                    offerId = offerTest[0].id;
                } else {
                    // can't trust scanner min level & quest; no way to match
                    response.warnings.push(`${tPrice.seller} had ${offerTest.length} offers for ${itemId}, skipping price insert`)
                }
                if (offerId) {
                    // we found a matching offer
                    let offer = offerTest[0];
                    const offerUpdateVars = ['timestamp = CURRENT_TIMESTAMP()'];
                    const offerUpdateValues = [];
                    if (offer.currency != tPrice.currency) {
                        offerUpdateVars.push(`currency = ?`);
                        offerUpdateValues.push(tPrice.currency)
                    }
                    if (options.trustTraderUnlocks && userFlags.trustTraderUnlocks & user.flags) {
                        // only update if we can trust scanner info
                        if (tPrice.minLevel !== null && offer.min_level != tPrice.minLevel) {
                            offerUpdateVars.push(`min_level = ?`);
                            offerUpdateValues.push(tPrice.minLevel);
                        }
                        if (isNaN(tPrice.quest)) {
                            //bsg id
                            if (offer.quest_unlock_bsg_id != tPrice.quest) {
                                if (tPrice.quest) {
                                    offerUpdateVars.push(`quest_unlock_bsg_id = ?`);
                                    offerUpdateValues.push(tPrice.quest);
                                } else {
                                    offerUpdateVars.push('quest_unlock_id = NULL');
                                    offerUpdateVars.push('quest_unlock_bsg_id = NULL');
                                }
                            }
                        } else {
                            //tarkovdata id
                            if (offer.quest_unlock_id != tPrice.quest) {
                                if (tPrice.quest) {
                                    offerUpdateVars.push(`quest_unlock_id = ?`);
                                    offerUpdateValues.push(tPrice.quest);
                                } else {
                                    offerUpdateVars.push('quest_unlock_id = NULL');
                                    offerUpdateVars.push('quest_unlock_bsg_id = NULL');
                                }
                            }
                        }
                    }
                    if (offerUpdateVars.length > 0) {
                        // update this offer
                        offerUpdateVars.push(`scanner_id = ?`);
                        offerUpdateValues.push(options.scanner.id);
                        await query(`UPDATE trader_items
                            SET ${offerUpdateVars.join(', ')}
                            WHERE id = '${offerId}'
                        `, offerUpdateValues);
                    }
                }
            }
            if (!offerId && options.trustTraderUnlocks && userFlags.trustTraderUnlocks & user.flags) {
                // offer does not exist, so we create it
                // but only if our trader data is reliable
                const offerValues = [itemId, tPrice.seller.toLowerCase(), tPrice.currency];
                let minLevel = 'NULL';
                if (tPrice.minLevel !== null) {
                    minLevel = '?';
                    offerValues.push(tPrice.minLevel);
                }
                let quest = 'NULL';
                let questIdField = 'quest_unlock_id';
                if (tPrice.quest !== null) {
                    quest = '?';
                    let questId = tPrice.quest;
                    if (isNaN(tPrice.quest)) {
                        questIdField = 'quest_unlock_bsg_id';
                    } else {
                        questId = parseInt(questId);
                    }
                    offerValues.push(questId);
                }
                offerValues.push(options.scanner.id);
                try {
                    const result = await query(`
                        INSERT INTO trader_items
                        (item_id, trader_name, currency, min_level, ${questIdField}, timestamp, scanner_id) VALUES
                        (?, ?, ?, ${minLevel}, ${quest}, CURRENT_TIMESTAMP(), ?)
                    `, offerValues);
                    offerId = result.insertId;
                } catch (error) {
                    response.errors.push(String(error));
                }
            }
            if (offerId) {
                placeholders.push(`(?, ?, ?, now())`);
                traderValues.push(offerId, Math.ceil(tPrice.price), options.scanner.id);
            }
        }
        if (traderValues.length > 0) {
            if (skipInsert) {
                response.warnings.push(`Skipped insert of ${traderValues.length} trader prices`);
            } else {
                traderInsert = query(`INSERT INTO trader_price_data (trade_id, price, scanner_id, timestamp) VALUES ${placeholders.join(', ')}`, traderValues);
            }
        } else {
            traderInsert = Promise.reject(new Error(`Could not find any matching offers for ${itemId}`));
        }
    } else if (traderPrices.length > 0) {
        traderInsert = Promise.reject(new Error('User not authorized to insert trader prices'));
    }
    const results = await Promise.allSettled([playerInsert, traderInsert]);
    for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'rejected') {
            response.errors.push(String(results[i].reason));
            response.data[i] = String(results[i].reason);
        } else {
            response.data[i] = results[i].value.affectedRows
        }
    }
    try {
        if (response.errors.length < 1) {
            await releaseItem({...options, scanned: true});
        }
    } catch (error) {
        response.errors.push(String(error));
    }
    return response;
};

//To set an item as scanned, include the attribtues offersFrom, scanned (true), and itemId 
// on success, response.data is the number of items set scanned (should be 1)

//To release a single item without setting as scanned, include the attribtues offersFrom, and itemId
// on success, response.data is the number of items released (probably 1)
// might be 0 if the item was already released for some reason

//To release all items, include the attribtue offersFrom
// on success, response.data is the number of items released
const releaseItem = async (options) => {
    const response = {errors: [], warnings: [], data: 0};
    if (options.imageOnly) {
        return response;
    }
    const itemId = options.itemId;
    const itemScanned = options.scanned || typeof options.offerCount !== 'undefined';
    const skipInsert = userFlags.skipPriceInsert & options.user.flags || scannerFlags.skipPriceInsert & options.scanner.flags;
    const escapedValues = [];
    let where = [];
    let scanned = '';
    let trader = '';
    let setLastScan = false;
    if (options.offersFrom === 1) {
        trader = 'trader_'
    }
    if (itemScanned && itemId && !skipInsert) {
        scanned = `, ${trader}last_scan = now()`;
        if (options.offerCount) {
            scanned += `, last_offer_count = ?`;
            escapedValues.push(options.offerCount);
        }
        setLastScan = true;
    } else if (!itemScanned || skipInsert) {
        where.push(`item_data.${trader}checkout_scanner_id = ?`);
        escapedValues.push(options.scanner.id);
    }
    if (itemId) {
        where.push('item_data.id = ?');
        escapedValues.push(itemId);
    }
    let sql = `
        UPDATE item_data
        SET ${trader}checkout_scanner_id = NULL${scanned}
        WHERE ${where.join(' AND ')}
    `;
    try {
        const result = await query(sql, escapedValues).then(result => {
            if (setLastScan) {
                query(`
                    UPDATE scanner
                    SET ${trader}last_scan = now()
                    WHERE id = ?
                `, [options.scanner.id]);
            }
            return result;
        });
        response.data = result.affectedRows;
    } catch (error) {
        response.errors.push(String(error));
    }
    return response;
};

const startTraderScan = async (options) => {
    const activeScan = await query('SELECT * from trader_offer_scan WHERE ended IS NULL OR ended >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)');
    if (activeScan.length > 0) {
        return {
            data: {
                id: activeScan[0].id,
                started: activeScan[0].started,
            }
        }
    }
    await query('INSERT INTO trader_offer_scan (scanner_id) VALUES (?)', [options.scanner.id]);
    return startTraderScan(options);
};

const endTraderScan = async (options) => {
    const activeScan = await query('SELECT * from trader_offer_scan WHERE ended IS NULL');
    if (activeScan.length < 1) {
        return {
            data: 'no active trader scan',
        };
    }
    const stopResult = await query('UPDATE trader_offer_scan SET ended=now() WHERE id=?', [activeScan[0].id]);
    if (stopResult.affectedRows < 1) {
        return {
            data: 'unable to update active trader scan',
        }
    }
    return {
        data: 'Trader scan ended',
    }
};

const addTraderOffers = async (options) => {
    const response = {
        data: [],
        warnings: [],
        errors: [],
    };
    const dataActions = [];
    const scannedIds = options.offers.reduce((all, current) => {
        if (!all.includes(current.item)) {
            all.push(current.item);
        }
        return all;
    }, []);
    for (const offer of options.offers) {
        const insertValues = {
            id: offer.offerId,
            item_id: offer.item,
            trader_id: offer.seller,
            min_level: offer.minLevel,
            buy_limit: offer.buyLimit,
            restock_amount: offer.restockAmount,
        };
        if (options.trustTraderUnlocks) {
            insertValues.locked = offer.locked ? 1 : 0;
        }
        if (!offer.requirements) {
            insertValues.price = offer.price;
            insertValues.currency = offer.currency;
        } else {
            insertValues.price = null;
            insertValues.currency = null;
        }
        const updateValues = Object.keys(insertValues).reduce((all, current) => {
            if (current !== 'id') {
                all[current] = insertValues[current];
            }
            return all;
        }, {});
        dataActions.push(query(`
            INSERT INTO trader_offers
                (${Object.keys(insertValues).join(', ')}, last_scan)
            VALUES
                (${Object.keys(insertValues).map(() => '?').join(', ')}, now())
            ON DUPLICATE KEY UPDATE ${Object.keys(updateValues).map(field => `${field}=?`).join(', ')}, last_scan=now()
        `, [...Object.values(insertValues), ...Object.values(updateValues)]).then(async () => {
            if (offer.requirements) {
                await query(`DELETE FROM trader_offer_requirements WHERE offer_id=?`, [offer.offerId]);
                const requirementActions = [];
                for (const req of offer.requirements) {
                    let properties = null;
                    let itemId = req.item;
                    if (req.level || isDogtag(itemId)) {
                        properties = JSON.stringify({
                            level: req.level,
                        });
                    }
                    if (isDogtag(itemId) && req.side === 'Any') {
                        itemId = 'customdogtags12345678910';
                    }
                    requirementActions.push(query(`
                        INSERT INTO trader_offer_requirements
                            (offer_id, requirement_item_id, count, properties)
                        VALUES
                            (?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE count=?, properties=?
                    `, [offer.offerId, itemId, req.count, properties, req.count, properties]));
                }
                return Promise.all(requirementActions).then(() => { 
                    return { result: 'ok' };
                });
            }
            return { result: 'ok' };
        }).catch(error => {
            return {
                result: 'error',
                message: error.message,
            };
        }));
    }
    if (options.offersFrom === 1) {
        await Promise.all(scannedIds.map(id => {
            return releaseItem({...options, itemId: id, scanned: true});
        }));
    }
    response.data = await Promise.all(dataActions);
    return response;
};

const insertTraderRestock = async (options) => {
    const response = {errors: [], warnings: [], data: 0};
    const trader = options.trader;
    if (!trader) {
        response.errors.push('no trader specified');
    }
    const timer = options.timer;
    if (!timer) {
        response.errors.push('no timer specified');
    }
    if (response.errors.length > 0) {
        return response;
    }
    try {
        const result = await query(`INSERT INTO trader_reset (trader_name, reset_time) VALUES (?, ?)`, [trader, timer]);
        response.data = result.affectedRows;
    } catch (error) {
        response.errors.push(String(error));
    }
    return response;
};

const getJson = (options) => {
    const response = {errors: [], warnings: [], data: {}};
    try {
        let file = options.file;
        file = file.split('/').pop();
        file = file.split('\\').pop();
        if (!file.endsWith('.json')) throw new Error(`${file} is not a valid json file`);
        if (fs.existsSync(path.join(__dirname, '..', 'cache', file))) {
            response.data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cache', file)));
        } else {
            response.data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dumps', file)));
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            response.errors.push(`Error: ${options.file} not found`);
        } else {
            response.errors.push(String(error));
        }
    }
    return response;
};

const submitImage = (request, user) => {
    const response = {errors: [], warnings: [], data: []};
    const form = formidable.formidable({
        multiples: true,
        uploadDir: path.join(__dirname, '..', 'cache'),
    });

    console.log(`User ${user.username} submitting image`);

    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        response.errors.push('aws variables not configured; image upload disabled');
        return response;
    }

    return new Promise(resolve => {
        const finish = (response, files) => {
            if (files) {
                for (const key in files.file) {
                    let file = files.file[key][0];
                    fs.rm(file.filepath, error => {
                        if (error) {
                            console.log(`Error deleting ${file.filepath}`, error);
                        }
                    });
                }
            }
            resolve(response);
        };
        form.parse(request, async (err, fields, files) => {
            if (err) {
                console.log(err);
                response.errors.push(String(err));
                return resolve(response);
            }

            fields = {
                id: fields.id[0],
                type: fields.type[0],
                presets: fields.presets ? fields.presets[0].split(',') : [],
                overwrite: fields.overwrite ? fields.overwrite[0] : false,
            };
    
            //console.log(fields);
            //console.log(JSON.stringify(files, null, 4));
    
            const allItemData = await remoteData.get();
            const currentItemData = allItemData.get(fields.id);
            const checkImageExists = imageType => {
                const field = imageSizes[imageType].field;
                return currentItemData[field];
            };

            if (fields.type === 'source') {
                /*if (fields.overwrite !== 'true') {
                    for (const imgType of Object.keys(imageSizes)) {
                        if (checkImageExists(imgType)) {
                            console.log(`Item ${fields.id} already has a ${imgType} image`);
                            response.errors.push(`Item ${fields.id} already has a ${imgType} image`);
                            return finish(response, files);
                        }
                    }
                }*/
                try {
                    response.data = await createAndUploadFromSource(files[fields.type][0].filepath, fields.id, fields.overwrite);
                    for (const presetId of fields.presets) {
                        let matchedPreset;
                        if (presetId === 'default') {
                            matchedPreset = presets.presets.find(preset => preset.baseId === fields.id && preset.default);
                        } else {
                            matchedPreset = presets.presets.find(preset => preset.id === presetId);
                        }
                        if (matchedPreset) {
                            const presetResult = await createAndUploadFromSource(files[presetId][0].filepath, matchedPreset.id, fields.overwrite);
                            response.data.push(...presetResult);
                        }
                    }
                } catch (error) {
                    console.error(error);
                    if (Array.isArray(error)) {
                        response.errors.push(...error.map(err => String(err)));
                    } else {
                        response.errors.push(String(error));
                    }
                    return finish(response, files);
                }
                return finish(response, files);
            }
    
            if(!Object.keys(imageSizes).includes(fields.type)) {
                console.log(`Invalid image type: ${fields.type}`);
                response.errors.push(`Invalid image type: ${fields.type}`);
                return finish(response, files);
            }
    
            let imageExists = checkImageExists(fields.type);

            if (imageExists && fields.overwrite !== 'true' && !(userFlags.overwriteImages & user.flags)) {
                console.log(`Item ${fields.id} already has a ${fields.type}`);
                response.errors.push(`Item ${fields.id} already has a ${fields.type}`);
                return finish(response, files);
            }
    
            try {
                response.data.push({
                    type: fields.type,
                    purged: await uploadToS3(files[fields.type][0].filepath, fields.type, fields.id)
                });
            } catch (error) {
                console.error(error);
                if (Array.isArray(error)) {
                    response.errors.push(...error.map(err => String(err)));
                } else {
                    response.errors.push(String(error));
                }
                return finish(response, files);
            }
    
            console.log(`${fields.id} ${fields.type} updated`);
            return finish(response, files);
        });
    });
};

const submitData = (options) => {
    const response = {errors: [], warnings: [], data: {}};
    try {
        let filename = options.name;
        fs.writeFileSync(path.join(__dirname, '..', 'cache', `${filename}.json`), JSON.stringify(options.data, null, 4));
        response.data.filename = filename;
    } catch (error) {
        if (error.code === 'ENOENT') {
            response.errors.push(`Error: ${options.file} not found`);
        } else {
            response.errors.push(String(error));
        }
    }
    return response;
};

const userFlags = {
    disabled: 0,
    insertPlayerPrices: 1,
    insertTraderPrices: 2,
    trustTraderUnlocks: 4,
    skipPriceInsert: 8,
    jsonDownload: 16,
    overwriteImages: 32,
    submitData: 64,
};

const scannerFlags = {
    none: 0,
    ignoreMissingScans: 1,
    skipPriceInsert: 2
};

const refreshUsers = async () => {
    if (refreshingUsers) return refreshingUsers;
    refreshingUsers = new Promise((resolve, reject) => {
        query('SELECT * from scanner_user WHERE disabled=0').then(results => {
            users = {};
            const scannerQueries = [];
            for (const user of results) {
                users[user.username] = user;
                scannerQueries.push(query('SELECT * from scanner WHERE scanner_user_id = ?', user.id).then(scanners => {
                    users[user.username].scanners = scanners;
                }));
            }
            Promise.all(scannerQueries).then(() => {
                resolve();
            }).catch(error => {
                reject(error);
            });
        });
    }).finally(() => {
        refreshingUsers = false;
    });
    return refreshingUsers;
};

refreshUsers();

const createScanner = async (user, scannerName) => {
    if (!(userFlags.insertPlayerPrices & user.flags) && !(userFlags.insertTraderPrices & user.flags)) {
        throw new Error('User not authorized to insert prices');
    }
    if (user.scanners.length >= user.max_scanners) {
        throw new Error(`Could not find scanner with name ${scannerName} and user already ad maximum scanners (${options.user.max_scanners})`);
    }
    if (scannerName.match(/[^a-zA-Z0-9_-]/g)) {
        throw new Error('Scanner names can only contain letters, numbers, dashes (-) and underscores (_)');
    }
    try {
        const result = await query('INSERT INTO scanner (scanner_user_id, name) VALUES (?, ?)', [user.id, scannerName]);
        const newScanner = {id: result.insertId, name: scannerName, scanner_user_id: user.id, flags: 0};
        user.scanners.push(newScanner);
        return newScanner;
    } catch (error) {
        if (error.toString().includes('Duplicate entry')) {
            throw new Error(`Scanner ${scannerName} already exists`);
        }
        throw error;
    }
};

const getUser = async (username) => {
    if (refreshingUsers) await refreshingUsers;
    return users[username];
};

const getScanner = async (options, createMissing) => {
    for (const scanner of options.user.scanners) {
        if (scanner.name === options.scannerName) {
            return scanner;
        }
    }
    if (!createMissing) {
        throw new Error(`Scanner with name ${options.scannerName} not found`);
    }
    const newScanner = await createScanner(options.user, options.scannerName);
    return newScanner;
};

const getScannerId = async (options, createMissing) => {
    const scanner = await getScanner(options. createMissing);
    return scanner.id;
};

const deleteScanner = async (options) => {
    const response = {errors: [], warnings: [], data: {}};
    // check if scanner has records in price_data, trader_items, trader_price_data before deleting
    try {
        let deleteScannerName = options.deleteScannerName;
        if (!deleteScannerName) {
            deleteScannerName = options.scannerName;
        }
        const scannerId = await getScannerId({user: options.user, scannerName: deleteScannerName}, false);
        const result = await query(`
            SELECT scanner.id, COALESCE(price_count, 0) as price_count, COALESCE(trader_offer_count, 0) as trader_offer_count, COALESCE(trader_price_count, 0) as trader_price_count
            FROM scanner
            LEFT JOIN (
                SELECT scanner_id, COUNT(id) as price_count
                FROM price_data
                WHERE scanner_id=?
                GROUP BY scanner_id
            ) prices ON scanner.id = prices.scanner_id
            LEFT JOIN (
                SELECT scanner_id, COUNT(id) as trader_offer_count
                FROM trader_items
                WHERE scanner_id=?
                GROUP BY scanner_id
            ) offers ON scanner.id = offers.scanner_id
            LEFT JOIN (
                SELECT scanner_id, COUNT(id) as trader_price_count
                FROM trader_price_data
                WHERE scanner_id=?
                GROUP BY scanner_id
            ) trader_prices ON scanner.id = trader_prices.scanner_id
            WHERE scanner.id=?
        `, [scannerId, scannerId, scannerId, scannerId]);
        if (result.price_count > 0 || result.trader_offer_count > 0 || result.trader_price_count > 0) {
            throw new Error('Cannot delete scanner with linked prices or trader offers.');
        }
        await query('DELETE FROM scanner WHERE id=?', [scannerId]);
        options.user.scanners = options.user.scanners.filter(scanner => {
            return scanner.id != scannerId;
        });
    } catch (error) {
        response.errors.push(String(error));
    }
    return response;
};

const renameScanner = async (options) => {
    const response = {errors: [], warnings: [], data: {}};
    try {
        let oldScannerName = options.scannerName;
        if (options.oldScannerName) {
            oldScannerName = options.oldScannerName;
        }
        const scannerId = await getScannerId({user: options.user, scannerName: oldScannerName}, false);
        if (options.newScannerName === oldScannerName) {
            throw new Error('newScannerName matches existing scanner name');
        }
        if (!options.newScannerName) {
            throw new Error('newScannerName cannot be blank');
        }
        if (options.newScannerName.match(/[^a-zA-Z0-9_-]/g)) {
            throw new Error('Scanner names can only contain letters, numbers, dashes (-) and underscores (_)');
        }
        await query(
            'UPDATE scanner SET name=? WHERE id=?', 
            [options.newScannerName, scannerId]
        );
        options.user.scanners.forEach(scanner => {
            if (scanner.id === scannerId) {
                scanner.name = options.newScannerName;
            }
        });
        response.data = 'ok';
    } catch (error) {
        response.errors.push(String(error));
    }
    return response;
};

module.exports = {
    request: async (req, res, resource) => {
        const username = req.headers.username;
        const password = req.headers.password;
        const user = await getUser(username);
        if ((!username || !password) || !user || !user.password || (user.password !== password)) {
            res.json({errors: ['access denied'], warnings: [], data: {}});
            return;
        }
        let response = false;
        let options = {};
        if (resource === 'image') {
            response = await submitImage(req, user);
        }
        if (!response) {
            options = req.body;
            if (typeof options !== 'object') {
                options = {};
            }
            options = getOptions(options, user);
        }
        if (resource === 'json') {
            if (user.flags & userFlags.jsonDownload) {
                response = getJson(options);
            } else {
                return res.json({errors: ['You are not authorized to perform that action'], warnings: [], data: {}});
            }
        }
        if (resource === 'submit-data') {
            if (user.flags & userFlags.submitData) {
                response = submitData(req.body);
            } else {
                return res.json({errors: ['You are not authorized to perform that action'], warnings: [], data: {}});
            }
        }
        try {
            const scannerName = req.headers.scanner;
            if (!scannerName && !response) {
                res.json({errors: ['no scanner name specified'], warnings: [], data: {}});
                return;
            }
            options.scannerName = scannerName;
            if (resource === 'items') {
                options.scanner = await getScanner(options, true);
                if (req.method === 'GET') {
                    response = await getItems(options);
                }
                if (req.method === 'POST') {
                    response = await insertPrices(options);
                }
                if (req.method === 'DELETE') {
                    response = await releaseItem(options);
                }
            }
            if (resource === 'scanner') {
                options.scanner = await getScanner(options, false);
                if (req.method === 'DELETE') {
                    response = await deleteScanner(options);
                }
                if (req.method === 'POST') {
                    response = await renameScanner(options);
                }
            }
            /*if (resource === 'traders') {
                if (req.method === 'POST') {
                    response = await insertTraderRestock(options);
                }
            }*/
            if (resource === 'trader-scan') {
                if (req.method === 'POST') {
                    options.scanner = await getScanner(options, false);
                    response = await startTraderScan(options);
                }
                if (req.method === 'PATCH') {
                    response = await endTraderScan(options);
                }
            }
            if (resource === 'offers') {
                if (req.method === 'POST') {
                    options.scanner = await getScanner(options, true);
                    response = await addTraderOffers(options);
                }
            }
            if (resource === 'ping' && req.method === 'GET') {
                response = {errors: [], warnings: [], data: 'ok'};
            }
        } catch (error) {
            console.log('Scanner API Error', error);
            res.json({errors: [String(error)], warnings: [], data: {}});
            return;
        }
        if (response) {
            res.json(response);
            return;
        }
        res.json({errors: ['unrecognized request'], warnings: [], data: {}});
    },
    refreshUsers: refreshUsers,
    getUserFlags: () => {
        return {
            ...userFlags
        }
    },
    getScannerFlags: () => {
        return {
            ...scannerFlags
        }
    },
    waitForActions: async () => {
        if (refreshingUsers) return refreshingUsers;
        return Promise.resolve();
    }
};
