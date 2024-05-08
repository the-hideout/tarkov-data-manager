const midmean = require('compute-midmean');
const timer = require('./console-timer');
const { query, maxQueryRows } = require('./db-connection');

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
        console.log('Loading item data');

        try {
            const allDataTimer = timer('item-data-query');
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
                allDataTimer.end();
                return rows;
            });

            const returnData = new Map();

            for(const result of results){
                Reflect.deleteProperty(result, 'item_id');
                Reflect.deleteProperty(result, 'base_price');

                const preparedData = {
                    ...result,
                    types: result.types?.split(',') || [],
                    updated: result.last_update,
                    lastLowPrice: 0,
                    avg24hPrice: 0,
                };
                if (!preparedData.properties) preparedData.properties = {};
                returnData.set(result.id, preparedData);
            }

            myData = returnData;
            lastRefresh = new Date();
            return returnData;
        } catch (error) {
            return Promise.reject(error);
        }
    },
    getWithPrices: async (refreshItems = false) => {
        console.log('Loading price data');

        try {
            const itemsPromise = methods.get(refreshItems);

            const wipes = await query('SELECT * FROM wipe ORDER BY start_date desc limit 1');
            const currentWipe = wipes[0];
            
            const price24hTimer = timer('item-24h-price-query');
            const price24hPromise = new Promise(async (resolve, reject) => {
                const batchSize = maxQueryRows;
                let offset = 0;
                try {
                    const priceResults = [];
                    while (true) {
                        const moreData = await query(`
                            SELECT
                                price,
                                item_id
                            FROM
                                price_data
                            WHERE
                                timestamp > DATE_SUB(NOW(), INTERVAL 1 DAY)
                            LIMIT ?, ?
                        `, [offset, batchSize]);
                        moreData.forEach(r => priceResults.push(r));
                        if (moreData.length < batchSize) {
                            break;
                        }
                        offset += batchSize;
                    }
                    price24hTimer.end();
                    resolve(priceResults);
                } catch (error) {
                    reject(error);
                }
            });

            const lastLowPriceTimer = timer('item-last-low-price-query');
            const lastLowPricePromise = query(`
                SELECT
                    a.item_id,
                    MIN(a.price) AS price,
                    timestamp
                FROM
                    price_data a
                INNER JOIN (
                    SELECT
                        MAX(timestamp) AS max_timestamp,
                        item_id
                    FROM 
                        price_data
                    WHERE
                        timestamp > ?
                    GROUP BY
                        item_id
                ) b
                ON
                    a.item_id = b.item_id AND a.timestamp = b.max_timestamp
                GROUP BY
                    a.item_id, a.timestamp;
            `, [currentWipe.start_date]).then(results => {
                lastLowPriceTimer.end();
                return results;
            });

            const priceYesterdayTimer = timer('price-yesterday-query');
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
                priceYesterdayTimer.end();
                return results;
            });

            const [
                items,
                price24hResults,
                lastLowPriceResults,
                avgPriceYesterday,
            ] = await Promise.all([
                itemsPromise,
                price24hPromise,
                lastLowPricePromise,
                avgPriceYesterdayPromise,
            ]);

            const item24hPrices = {};

            price24hResults.forEach((resultRow) => {
                if (!item24hPrices[resultRow.item_id]) {
                    item24hPrices[resultRow.item_id] = [];
                }
                item24hPrices[resultRow.item_id].push(resultRow.price);
            });

            for (const [itemId, item] of items) {
                item.updated = item.last_update;
                if (item.types.includes('no-flea')) {    
                    continue;
                }

                const lastLowData = lastLowPriceResults.find(row => row.item_id === itemId);
                if (lastLowData) {
                    item.lastLowPrice = lastLowData.price;
                    item.updated = lastLowData.timestamp;
                }

                item24hPrices[itemId]?.sort();
                item.avg24hPrice = getInterquartileMean(item24hPrices[itemId] || []);
                item.low24hPrice = item24hPrices[itemId]?.at(0);
                item.high24hPrice = item24hPrices[itemId]?.at(item24hPrices[itemId]?.length - 1);

                const itemPriceYesterday = avgPriceYesterday.find(row => row.item_id === itemId);
                if (!itemPriceYesterday || item.avg24hPrice === 0) {
                    item.changeLast48h = 0;
                    item.changeLast48hPercent = 0;
                } else {
                    item.changeLast48h = Math.round(item.avg24hPrice - itemPriceYesterday.priceYesterday);
                    const percentOfDayBefore = item.avg24hPrice / itemPriceYesterday.priceYesterday;
                    item.changeLast48hPercent = Math.round((percentOfDayBefore - 1) * 100 * 100) / 100;
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
        if (currentItemData[property] === value)
            return false;
        console.log(`Setting ${property} to ${value} for ${id}`);
        currentItemData[property] = value;
        myData.set(id, currentItemData);
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
            if (insertResult.insertId !== 0){
                myData.set(values.id, {
                    ...values,
                    types: [],
                    updated: new Date(),
                });
            } else if (insertResult.affectedRows > 0) {
                myData.set(values.id, {
                    ...myData.get(values.id),
                    ...values,
                });
            }
            return insertResult;
        });
    },
};

module.exports = methods;