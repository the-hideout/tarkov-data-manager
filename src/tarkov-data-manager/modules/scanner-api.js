const { response } = require('express');
const {pool, query, format} = require('./db-connection');

let users = {};

/*const isConnected = async () => {
    if (!pool) return false;
    return new Promise((resolve) => {
        pool.getConnection((err, connection) => {
            if (err) {
                resolve(false);
                return;
            }
            connection.release();
            resolve(true);
        });
    });
};*/

const getOptions = (req, res) => {
    const response = {errors: [], warnings: [], data: {}};
    const defaultOptions = {
        limitItem: false,
        imageOnly: false,
        batchSize: 50,
        offersFrom: 2,
        scannerName: false,
        limitTraderScan: true,
        trustTraderUnlocks: false
    }
    options = {
        ...defaultOptions,
        ...req.body
    };
    if (!options.scannerName) {
        response.errors.push('no scanner name specified');
    }
    if (response.errors.length > 0) {
        res.json(response);
        return false;
    }
    if (options.limitItem && typeof options.limitItem === 'string') {
        options.limitItem = [options.limitItem];
    } else if (!options.limitItem) {
        options.limitItem = false;
    }
    return options;
};

const dateToMysqlFormat = (dateTime) => {
    const twoDigits = (d) => {
        if(0 <= d && d < 10) {
            return '0' + d.toString();
        }

        if(-10 < d && d < 0) {
            return '-0' + (-1*d).toString();
        }

        return d.toString();
    };
    return dateTime.getUTCFullYear() + '-' + twoDigits(1 + dateTime.getUTCMonth()) + '-' + twoDigits(dateTime.getUTCDate()) + ' ' + twoDigits(dateTime.getUTCHours()) + ':' + twoDigits(dateTime.getUTCMinutes()) + ':' + twoDigits(dateTime.getUTCSeconds());
};

// on success, response.data is an array of items
const getItems = async(req, res) => {
    const response = {errors: [], warnings: [], data: []};
    let options = getOptions(req, res);
    if (!options) {
        return;
    }
    let items = false;
    if (options.limitItem) {
        let itemIds = options.limitItem;
        if (!Array.isArray(itemIds)) {
            itemIds = [itemIds];
        }
        const placeholders = [];
        for (let i=0; i < itemIds.length; i++) {
            placeholders.push('?');
        }
        const sql = format(`
            SELECT
                item_data.id,
                translations.value AS name,
                tran2.value AS shortName,
                item_data.match_index,
                item_data.image_link IS NULL OR item_data.image_link = '' AS needs_image,
                item_data.grid_image_link IS NULL OR item_data.grid_image_link = '' AS needs_grid_image,
                item_data.icon_link IS NULL OR item_data.icon_link = '' AS needs_icon_image
            FROM
                item_data
            LEFT JOIN translations ON
                translations.item_id = item_data.id
                AND
                    translations.type = 'name'
                AND
                    translations.language_code = 'en'
            LEFT JOIN translations tran2 ON
                tran2.item_id = item_data.id
                AND
                    tran2.type = 'shortname'
                AND
                    tran2.language_code = 'en'
            WHERE 
                item_data.id IN (${placeholders.join(',')})
            `, itemIds);
        try {
            items = await query(sql);
            response.data = items;
        } catch (error) {
            response.errors.push(String(error));
        }
        res.json(response);
        return;
    }
    if (options.imageOnly) {
        const sql = `
            SELECT
                item_data.id,
                translations.value AS name,
                tran2.value AS shortName,
                item_data.match_index,
                item_data.image_link IS NULL OR item_data.image_link = '' AS needs_image,
                item_data.grid_image_link IS NULL OR item_data.grid_image_link = '' AS needs_grid_image,
                item_data.icon_link IS NULL OR item_data.icon_link = '' AS needs_icon_image
            FROM
                item_data
            LEFT JOIN translations ON
                translations.item_id = item_data.id
                AND
                    translations.type = 'name'
                AND
                    translations.language_code = 'en'
            LEFT JOIN translations tran2 ON
                tran2.item_id = item_data.id
                AND
                    tran2.type = 'shortname'
                AND
                    tran2.language_code = 'en'
            LEFT JOIN types ON
                types.item_id = item_data.id
            WHERE NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'disabled') AND 
                NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'preset') AND 
                (item_data.image_link IS NULL OR item_data.image_link = '' OR item_data.grid_image_link IS NULL OR item_data.grid_image_link = '' OR item_data.icon_link IS NULL OR item_data.icon_link = '')
            GROUP BY item_data.id
            ORDER BY translations.value
        `;
        try {
            response.data = await query(sql);
        } catch (error) {
            response.errors.push(String(error));
        }
        res.json(response);
        return;
    }

    let maxItems = options.batchSize;
    if (maxItems > 200) {
        maxItems = 200;
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
        const checkoutSql = format(`
            UPDATE item_data
            SET checked_out_by = ?
            WHERE (checked_out_by IS NULL OR checked_out_by = ?) AND
                NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'disabled') AND 
                NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'preset') ${nofleaCondition} 
            ORDER BY last_scan, id
            LIMIT ?
        `, [options.scannerName,options.scannerName,maxItems]);
        await query(checkoutSql);

        conditions.push('item_data.checked_out_by = ?');
    } else {
        // trader-only price checkout
        let lastScanCondition = '';
        if (options.limitTraderScan) {
            lastScanCondition = 'AND (trader_last_scan <= DATE_SUB(now(), INTERVAL 1 DAY) OR trader_last_scan IS NULL)';
        }
        const checkoutSql = format(`
            UPDATE item_data
            SET trader_checked_out_by = ?
            WHERE ((trader_checked_out_by IS NULL OR trader_checked_out_by = ?) AND 
                NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'disabled') AND 
                NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'preset') ${lastScanCondition} )
            ORDER BY trader_last_scan, id
            LIMIT ?
        `, [options.scannerName,options.scannerName,maxItems]);
        await query(checkoutSql);

        conditions.push('item_data.trader_checked_out_by = ?');
    }

    let where = '';
    if (conditions.length > 0) {
        where = `WHERE ${conditions.join(' AND ')}`;
    }
    const sql = format(`
        SELECT
            item_data.id,
            translations.value AS name,
            tran2.value AS shortName,
            item_data.match_index,
            item_data.image_link IS NULL OR item_data.image_link = '' AS needs_image,
            item_data.grid_image_link IS NULL OR item_data.grid_image_link = '' AS needs_grid_image,
            item_data.icon_link IS NULL OR item_data.icon_link = '' AS needs_icon_image
        FROM
            item_data
        LEFT JOIN translations ON
            translations.item_id = item_data.id
            AND
                translations.type = 'name'
            AND
                translations.language_code = 'en'
        LEFT JOIN translations tran2 ON
            tran2.item_id = item_data.id
            AND
                tran2.type = 'shortname'
            AND
                tran2.language_code = 'en'
        LEFT JOIN types ON
            types.item_id = item_data.id
        ${where}
        GROUP BY item_data.id
        ORDER BY item_data.last_scan
    `, [options.scannerName]);
    try {
        response.data = await query(sql);
        //console.log('retrieved items', response.data);
    } catch (error) {
        response.errors.push(String(error));
    }
    res.json(response);
};

//on success, response.data is an array with the first element being the number of player prices inserted
//and the second element being the number of trader prices inserted
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
insertPrices = async (req, res) => {
    const response = {errors: [], warnings: [], data: [0, 0]};
    let options = getOptions(req, res);
    if (!options) {
        return;
    }
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
        res.json(response);
        return;
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
    if (playerPrices.length > 0) {
        // player prices
        const placeholders = [];
        const values = [];
        for (let i = 0; i < playerPrices.length; i++) {
            placeholders.push('(?, ?, ?, ?)');
            values.push(itemId, playerPrices[i].price, options.scannerName, dateToMysqlFormat(dateTime))
        }    
        playerInsert = query(format(`INSERT INTO price_data (item_id, price, source, timestamp) VALUES ${placeholders.join(', ')}`, values));
    }
    if (traderPrices.length > 0) { 
        // trader prices
        //const traderPriceInserts = [];
        const placeholders = [];
        const traderValues = [];
        for (let i = 0; i < traderPrices.length; i++) {
            const tPrice = traderPrices[i];
            let offerId = false;
            const testOfferSql = format(`
                SELECT id, currency, min_level, quest_unlock_id FROM trader_items
                WHERE item_id=? AND trader_name=?
            `, [itemId, tPrice.seller.toLowerCase()]);
            const offerTest = await query(testOfferSql);
            if (offerTest.length > 0) {
                // offer exists
                if (options.trustTraderUnlocks) {
                    // can trust scanner min level & quest
                    // attempt to match
                    const matchedOffers = [];
                    for (let oi = 0; oi < offerTest.length; oi++) {
                        if ((tPrice.minLevel === null || offerTest[oi].min_level == tPrice.minLevel) && offerTest[oi].quest_unlock_id == tPrice.quest) {
                            matchedOffers.push(offerTest[oi].id);
                        }
                    }
                    if (matchedOffers.length == 1) {
                        offerId = matchedOffers[0];
                    } else if (matchedOffers.length > 1) {
                        response.warnings.push(`${tPrice.seller} had ${matchedOffers.length} matching offers for ${itemId}, skipping price insert`);
                    }
                } else if (offerTest.length == 1) {
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
                    if (options.trustTraderUnlocks) {
                        // only update if we can trust scanner info
                        if (tPrice.minLevel !== null && offer.min_level != tPrice.minLevel) {
                            offerUpdateVars.push(`min_level = ?`);
                            offerUpdateValues.push(tPrice.minLevel);
                        }
                        if (offer.quest_unlock_id != tPrice.quest) {
                            if (tPrice.quest) {
                                offerUpdateVars.push(`quest_unlock_id = ?`);
                                offerUpdateValues.push(tPrice.quest);
                            } else {
                                offerUpdateVars.push('quest_unlock_id = NULL');
                            }
                        }
                    }
                    if (offerUpdateVars.length > 0) {
                        // update this offer
                        const sql = format(`UPDATE trader_items
                            SET ${offerUpdateVars.join(', ')}
                            WHERE id = '${offerId}'
                        `, offerUpdateValues);
                        await query(sql);
                    }
                }
            }
            if (!offerId && options.trustTraderUnlocks) {
                // offer does not exist, so we create it
                // but only if our trader data is reliable
                const offerValues = [itemId, tPrice.seller.toLowerCase(), tPrice.currency];
                let quest = 'NULL';
                if (tPrice.quest !== null) {
                    quest = '?';
                    offerValues.push(tPrice.quest);
                }
                let minLevel = 'NULL';
                if (tPrice.minLevel !== null) {
                    minLevel = '?';
                    offerValues.push(tPrice.minLevel);
                }
                const createOfferSql = format(`
                    INSERT INTO trader_items
                    (item_id, trader_name, currency, min_level, quest_unlock_id, timestamp) VALUES
                    (?, ?, ?, ${minLevel}, ${quest}, CURRENT_TIMESTAMP())
                `, offerValues);
                try {
                    const result = await query(createOfferSql);
                    offerId = result.insertId;
                } catch (error) {
                    response.errors.push(String(error));
                }
            }
            if (offerId) {
                placeholders.push(`(?, ?, ?, ?)`);
                traderValues.push(offerId, tPrice.price, options.scannerName, dateToMysqlFormat(dateTime));
            }
        }
        if (traderValues.length > 0) {
            traderInsert = query(format(`INSERT INTO trader_price_data (trade_id, price, source, timestamp) VALUES ${placeholders.join(', ')}`, traderValues));
        } else {
            traderInsert = Promise.reject(new Error(`Could not find any matching offers for ${itemId}`));
        }
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
    res.json(response);
};

//on success, response.data is the number of items set scanned (should be 1)
const setItemScanned = async (req, res) => {
    let options = getOptions(req, res);
    if (!options) {
        return;
    }
    const response = {errors: [], warnings: [], data: 0};
    if (options.imageOnly) {
        res.json(response);
        return;
    }
    const itemId = options.itemId;
    if (!itemId) {
        response.errors.push('no item id specified');
        res.json(response);
        return;
    }
    // player prices
    // ok if we scanned trader prices too
    let sql = `
        UPDATE item_data
        SET checked_out_by = NULL, last_scan = CURRENT_TIMESTAMP()
        WHERE item_data.id = ?
    `;
    if (options.offersFrom == 1) {
        // trader-only prices
        sql = `
            UPDATE item_data
            SET trader_checked_out_by = NULL, trader_last_scan = CURRENT_TIMESTAMP()
            WHERE item_data.id = ?
        `;
    }
    try {
        const result = await query(format(sql, [itemId]));
        response.data = result.affectedRows;
    } catch (error) {
        response.errors.push(String(error));
    }
    res.json(response);
};

//on success, response.data is the number of items released
//might be 0 if the item was already released
const releaseItem = async (req, res) => {
    let options = getOptions(req, res);
    if (!options) {
        return;
    }
    const response = {errors: [], warnings: [], data: 0};
    const itemId = options.itemId;
    if (!itemId) {
        response.errors.push('no item id specified');
        res.json(response);
        return;
    }
    let sql = `
        UPDATE item_data
        SET checked_out_by = NULL
        WHERE item_data.id = ? AND item_data.checked_out_by = ?
    `;
    if (options.offersFrom === 1) {
        //trader-only prices
        sql = `
            UPDATE item_data
            SET trader_checked_out_by = NULL
            WHERE item_data.id = ? AND item_data.trader_checked_out_by = ?
        `;
    }
    try {
        const result = await query(format(sql, [itemId, options.scannerName]));
        response.data = result.affectedRows;
    } catch (error) {
        response.errors.push(String(error));
    }
    res.json(response);
};

const releaseAllItems = async (req, res) => {
    let options = getOptions(req, res);
    if (!options) {
        return;
    }
    const response = {errors: [], warnings: [], data: 0};
    if (options.offersFrom == 2 || options.offersFrom == 0) {
        const sql = format(`
            UPDATE item_data
            SET checked_out_by = NULL
            WHERE item_data.checked_out_by = ?
        `, [options.scannerName]);
        try {
            const result = await query(sql);
            response.data = result.affectedRows;
        } catch (error) {
            response.errors.push(String(error));
        }
        res.json(response);
        return;
    }
    //trader-only prices
    const sql = format(`
        UPDATE item_data
        SET trader_checked_out_by = NULL
        WHERE item_data.trader_checked_out_by = ?
    `, [options.scannerName]);
    try {
        const result = await query(sql);
        response.data = result.affectedRows;
    } catch (error) {
        response.errors.push(String(error));
    }
    res.json(response);
};

const insertTraderRestock = async (req, res) => {
    let options = getOptions(req, res);
    if (!options) {
        return;
    }
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
        res.json(response);
        return;
    }
    try {
        const result = await query(format(`INSERT INTO trader_reset (trader_name, reset_time) VALUES (?, ?)`, [trader, timer]));
        response.data = result.affectedRows;
    } catch (error) {
        response.errors.push(String(error));
    }
    res.json(response);
};

const ping = async (req, res) => {
    let options = getOptions(req, res);
    if (!options) {
        return;
    }
    res.json({errors: [], warnings: [], data: 'ok'});
};

const refreshUsers = async () => {
    const results = await query('SELECT username, password from scanner_user WHERE disabled=0');
    users = {};
    for (let i = 0; i < results.length; i++) {
        users[results[i].username] = results[i].password;
    }
};

refreshUsers();

module.exports = {
    request: async (req, res) => {
        const username = req.headers.username;
        const password = req.headers.password;
        if ((!username || !password) || !users[username] || (users[username] !== password)) {
            res.json({errors: ['access denied'], warnings: [], data: {}});
            return;
        }
        try {
            if (req.body.action === 'getItems') {
                return await getItems(req, res);
            }
            if (req.body.action === 'insertPrices') {
                return await insertPrices(req, res);
            }
            if (req.body.action === 'setItemScanned') {
                return await setItemScanned(req, res);
            }
            if (req.body.action === 'releaseItem') {
                return await releaseItem(req, res);
            }
            if (req.body.action === 'releaseAllItems') {
                return await releaseAllItems(req, res);
            }
            if (req.body.action === 'insertTraderRestock') {
                return await insertTraderRestock(req, res);
            }
            if (req.body.action === 'ping') {
                return await ping(req, res);
            }
        } catch (error) {
            console.log('Scanner API Error', error);
        }
    },
    refreshUsers: refreshUsers
};