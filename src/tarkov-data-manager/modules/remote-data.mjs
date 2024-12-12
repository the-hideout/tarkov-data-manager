import midmean from 'compute-midmean';

import normalizeName from './normalize-name.js';
import timer from './console-timer.js';
import { query, batchQuery } from './db-connection.mjs';
import gameModes from './game-modes.mjs';
import emitter from './emitter.mjs';

let myData = false;
let lastRefresh = new Date(0);

const getInterquartileMean = (validValues) => {
    if(validValues.length === 0){
        return 0;
    }

    if(validValues.length === 1){
        return validValues[0];
    }

    if(validValues.length === 2){
        return Math.floor((validValues[0] + validValues[1]) / 2)
    }

    const sortedValues = validValues.sort((a, b) => a - b);

    return Math.floor(midmean(sortedValues, true));

    // if(validValues[0].item_id === '59fb023c86f7746d0d4b423c'){
    //     console.log(sortedValues);
    // }

    // let sum = 0;
    // let lastPrice = 0;
    // let includedCount = 0;
    // for(const currentPrice of sortedValues){
    //     // Skip anything 10x the last value. Should skip packs
    //     if(currentPrice > lastPrice * 10 && lastPrice > 0){
    //         break;
    //     }

    //     includedCount = includedCount + 1;
    //     lastPrice = currentPrice;
    //     sum = sum + currentPrice;
    // }

    // return Math.floor(sum / includedCount);
};

const methods = {
    get: async (forceRefresh = false) => {
        // refresh if data hasn't been loaded, it's a forced refresh, or if it's been > 10 minutes
        if (!myData || forceRefresh || new Date() - 1000 * 60 * 10 > lastRefresh) {
            return methods.refresh();
        }
        return myData;
    },
    refresh: async () => {
        //console.log('Loading item data');

        try {
            //const allDataTimer = timer('item-data-query');
            const results = await query(`
                SELECT
                    item_data.*,
                    GROUP_CONCAT(DISTINCT types.type SEPARATOR ',') AS types
                FROM
                    item_data
                LEFT JOIN types ON
                    types.item_id = item_data.id
                GROUP BY
                    item_data.id
            `).then(rows => {
                //allDataTimer.end();
                return rows;
            });

            const returnData = new Map();

            for (const result of results) {
                Reflect.deleteProperty(result, 'item_id');
                Reflect.deleteProperty(result, 'base_price');

                const preparedData = {
                    ...result,
                    types: result.types?.split(',') || [],
                    updated: result.last_update,
                    lastLowPrice: null,
                    avg24hPrice: null,
                    high24hPrice: null,
                    changeLast48h: null,
                    changeLast48hPercent: null,
                    lastLowPricePve: null,
                    avg24hPricePve: null,
                    high24hPricePve: null,
                    changeLast48hPve: null,
                    changeLast48hPercentPve: null,
                    lastOfferCount: result.last_offer_count,
                    pve_lastOfferCount: result.pve_last_offer_count,
                };
                if (!preparedData.properties) preparedData.properties = {};
                returnData.set(result.id, preparedData);
            }

            myData = returnData;
            lastRefresh = new Date();
            emitter.emit('dbItemsUpdated', myData);
            return returnData;
        } catch (error) {
            return Promise.reject(error);
        }
    },
    getWithPrices: async (refreshItems = false, logger = console) => {
        logger.log('Loading price data');

        try {
            const itemsPromise = methods.get(refreshItems);
            
            logger.time('item-24h-price-query');
            const price24hPromise = batchQuery(`
                SELECT
                    price,
                    item_id,
                    game_mode
                FROM
                    price_data
                WHERE
                    timestamp > DATE_SUB(NOW(), INTERVAL 1 DAY)
            `).finally(() => {
                logger.timeEnd('item-24h-price-query');
            });

            logger.time('item-last-price-query');
            const lastPricePromise = query(`
                SELECT
                    a.item_id,
                    a.price_min as price,
                    timestamp,
                    a.game_mode
                FROM
                    price_historical a
                INNER JOIN (
                    SELECT
                        MAX(timestamp) AS max_timestamp,
                        item_id,
                        game_mode
                    FROM 
                        price_historical
                    GROUP BY
                        item_id, game_mode
                ) b
                ON
                    a.item_id = b.item_id AND a.timestamp = b.max_timestamp AND a.game_mode = b.game_mode
            `).finally(() => {
                logger.timeEnd('item-last-price-query');
            });

            logger.time('price-yesterday-query');
            const avgPriceYesterdayPromise = query(`
                SELECT
                    avg(price) AS priceYesterday,
                    item_id,
                    game_mode
                FROM
                    price_data
                WHERE
                    timestamp > DATE_SUB(NOW(), INTERVAL 2 DAY)
                AND
                    timestamp < DATE_SUB(NOW(), INTERVAL 1 DAY)
                GROUP BY
                    item_id, game_mode
            `).finally(() => {
                logger.timeEnd('price-yesterday-query');
            });

            const [
                items,
                price24hResults,
                lastPriceResults,
                avgPriceYesterday,
            ] = await Promise.all([
                itemsPromise,
                price24hPromise,
                lastPricePromise,
                avgPriceYesterdayPromise,
            ]);

            const item24hPrices = price24hResults.reduce((all, resultRow) => {
                if (!all[resultRow.game_mode]) {
                    all[resultRow.game_mode] = {};
                }
                if (!all[resultRow.game_mode][resultRow.item_id]) {
                    all[resultRow.game_mode][resultRow.item_id] = [];
                }
                all[resultRow.game_mode][resultRow.item_id].push(resultRow.price);
                return all;
            }, {});

            const itemLastPrices = lastPriceResults.reduce((all, current) => {
                if (!all[current.game_mode]) {
                    all[current.game_mode] = {};
                }
                all[current.game_mode][current.item_id] = current;
                return all;
            }, {});

            for (const [itemId, item] of items) {
                item.updated = item.last_update;
                if (item.types.includes('no-flea')) {    
                    continue;
                }

                for (const gameMode of gameModes) {
                    const fieldPrefix = gameMode.name === 'regular' ? '' : `${gameMode.name}_`;

                    //const lastLowData = lastLowPriceResults.find(row => row.item_id === itemId && row.game_mode === gameMode.value);
                    const lastData = itemLastPrices[gameMode.value]?.[itemId];
                    if (lastData) {
                        item[`${fieldPrefix}lastLowPrice`] = lastData.price;
                        const updatedField = `${fieldPrefix}updated`;
                        item[updatedField] = lastData.timestamp;
                    }
    
                    item24hPrices[gameMode.value][itemId]?.sort();
                    item[`${fieldPrefix}avg24hPrice`] = getInterquartileMean(item24hPrices[gameMode.value][itemId] || []) || null;
                    item[`${fieldPrefix}low24hPrice`] = item24hPrices[gameMode.value][itemId]?.at(0);
                    item[`${fieldPrefix}high24hPrice`] = item24hPrices[gameMode.value][itemId]?.at(item24hPrices[gameMode.value][itemId]?.length - 1);
    
                    const itemPriceYesterday = avgPriceYesterday.find(row => row.item_id === itemId && row.game_mode === gameMode.value);
                    if (!itemPriceYesterday || item[`${fieldPrefix}avg24hPrice`] === 0) {
                        item[`${fieldPrefix}changeLast48h`] = 0;
                        item[`${fieldPrefix}changeLast48hPercent`] = 0;
                    } else {
                        item[`${fieldPrefix}changeLast48h`] = Math.round(item[`${fieldPrefix}avg24hPrice`] - itemPriceYesterday.priceYesterday);
                        const percentOfDayBefore = item[`${fieldPrefix}avg24hPrice`] / itemPriceYesterday.priceYesterday;
                        item[`${fieldPrefix}changeLast48hPercent`] = Math.round((percentOfDayBefore - 1) * 100 * 100) / 100;
                    }
                }
            }
            return items;
        } catch (error) {
            return Promise.reject(error);
        }
    },
    updateTypes: async updateObject => {
        await methods.get();
        const currentItemData = myData.get(updateObject.id);

        if(updateObject.active === false && !currentItemData.types.includes(updateObject.type)){
            return true;
        }

        if(updateObject.active === false){
            currentItemData.types.splice(currentItemData.types.indexOf(updateObject.type), 1);
            methods.removeType(updateObject.id, updateObject.type);
        }

        if(updateObject.active === true){
            currentItemData.types.push(updateObject.type);
            methods.addType(updateObject.id, updateObject.type);
        }

        myData.set(updateObject.id, currentItemData);
    },
    addType: async (id, type) => {
        //console.log(`Adding ${type} for ${id}`);
        const [itemData, insertResult] = await Promise.all([
            methods.get(),
            query(`INSERT IGNORE INTO types (item_id, type) VALUES (?, ?)`, [id, type]),
        ]);
        const item = myData.get(id);
        if (item && !item.types.includes(type)) {
            item.types.push(type);
        }
        return insertResult;
    },
    removeType: async (id, type) => {
        //console.log(`Removing ${type} for ${id}`);
        const [itemData, deleteResult] = await Promise.all([
            methods.get(),
            query(`DELETE FROM types WHERE item_id = ? AND type= ?`, [id, type])
        ]);
        const item = myData.get(id);
        if (item) {
            item.types = item.types.filter(t => t !== type);
        }
        return deleteResult;
    },
    setProperty: async (id, property, value) => {
        const currentItemData = myData.get(id);
        if (currentItemData[property] === value) {
            return false;
        }
        console.log(`Setting ${property} to ${value} for ${id}`);
        currentItemData[property] = value;
        return query(`UPDATE item_data SET ${property} = ? WHERE id = ?`, [value, id]);
    },
    setProperties: async (id, properties) => {
        const currentItemData = myData.get(id);
        const changeValues = {};
        for (const property in properties) {
            if (property === 'id') {
                continue;
            }
            if (property === 'types') {
                console.log('Cannot set types via setProperties');
                continue;
            }
            let value = properties[property];
            let currentValue = currentItemData[property];
            if (property === 'properties') {
                currentValue = JSON.stringify(currentValue);
                value = JSON.stringify(value);
            }
            if (currentValue !== value) {
                changeValues[property] = value;
                if (property === 'name' && !properties.normalized_name) {
                    changeValues.normalized_name = normalizeName(value);
                }
            }
        }
        if (Object.keys(changeValues).length === 0) {
            return;
        }
        console.log(`Setting ${currentItemData.name} ${id} properties to`, changeValues);
        const fieldNames = [];
        const placeHolderValues = [];
        for (const property in changeValues) {
            fieldNames.push(`${property} = ?`);
            placeHolderValues.push(changeValues[property])
        }
        placeHolderValues.push(id);
        return query(`UPDATE item_data SET ${fieldNames.join(', ')} WHERE id = ?`, placeHolderValues).then(result => {
            for (const property in changeValues) {
                if (property === 'properties') {
                    currentItemData[property] = properties[property];
                } else {
                    currentItemData[property] = changeValues[property];
                }
            }
            return result;
        });
    },
    addItem: async (values) => {
        if (!values.id) {
            return Promise.reject(new Error('You must provide id to add an item'));
        }
        await methods.get();
        const insertFields = [];
        const insertValues = [];
        const updateFields = [];
        const updateValues = [];
        for (const property in values) {
            if (property === 'types') {
                continue;
            }
            let value = values[property];
            if (property === 'properties') {
                value = JSON.stringify(value);
            }
            insertFields.push(property);
            insertValues.push(value);
            if (property !== 'id') {
                updateFields.push(`${property}=?`);
                updateValues.push(value);
            }
        }
        return query(`
            INSERT INTO 
                item_data (${insertFields.join(', ')})
            VALUES (
                ${insertValues.map(() => '?')}
            )
            ON DUPLICATE KEY UPDATE
                ${updateFields.join(', ')}
        `, [...insertValues, ...updateValues]).then(insertResult => {
            if (insertResult.affectedRows > 0) {
                const currentItemData = myData.get(values.id);
                myData.set(values.id, {
                    ...currentItemData,
                    ...values,
                    types: currentItemData?.types ?? [],
                    updated: currentItemData?.updated ?? new Date(),
                });
            }
            return insertResult;
        });
    },
    removeItem: async (id) => {
        if (!id) {
            return Promise.reject(new Error('You must provide id to remove an item'));
        }
        await methods.get();
        if (!myData.has(id)) {
            return Promise.reject(new Error(`Item ${id} not found`));
        }
        const result = await query('DELETE FROM item_data WHERE id = ?', [id]);
        myData.delete(id);
        return result;
    },
    hasPrices: async (id) => {
        const fleaPrice = await query('select count(id) as num from price_data where item_id = ?', [id]);
        if (fleaPrice[0].num !== 0) {
            return true;
        }
        const priceArchive = await query('select count(item_id) as num from price_archive where item_id = ?', [id]);
        if (priceArchive[0].num !== 0) {
            return true;
        }
        const traderOffer = await query('select count(id) as num from trader_offers where item_id = ?', [id]);
        return traderOffer[0].num !== 0;
    },
    on: (event, listener) => {
        return emitter.on(event, listener);
    },
    off: (event, listener) => {
        return emitter.off(event, listener);
    },
    once: (event, listener) => {
        return emitter.once(event, listener);
    },
};

export default methods;