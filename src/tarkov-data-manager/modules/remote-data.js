const midmean = require('compute-midmean');
const timer = require('./console-timer');
const {query} = require('./db-connection');

let myData = false;
let lastRefresh = new Date(0);

const getPercentile = (validValues) => {
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
        console.log('Loading all data');

        const start = new Date();
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
                };
                if (!preparedData.properties) preparedData.properties = {};
                returnData.set(result.id, preparedData);
            }

            myData = returnData;
            lastRefresh = new Date();
            return Promise.resolve(returnData);
        } catch (error) {
            return Promise.reject(error);
        }
    },
    getWithPrices: async (refreshItems = false) => {
        console.log('Loading price data');

        const start = new Date();
        try {
            const resultsPromise = methods.get(refreshItems);
            
            const priceTimer = timer('price-query');
            const pricePromise = new Promise(async (resolve, reject) => {
                const batchSize = 100000;
                let offset = 0;
                const priceSql = `
                    SELECT
                        price,
                        item_id,
                        timestamp
                    FROM
                        price_data
                    WHERE
                        timestamp > DATE_SUB(NOW(), INTERVAL 1 DAY)
                    LIMIT ?, 100000
                `;
                try {
                    const priceResults = await query(priceSql, [offset]);
                    let moreResults = priceResults.length === 100000;
                    while (moreResults) {
                        offset += batchSize;
                        const moreData = await query(priceSql, [offset]);
                        priceResults.push(...moreData);
                        if (moreData.length < batchSize) {
                            moreResults = false;
                        }
                    }
                    priceTimer.end();
                    resolve(priceResults);
                } catch (error) {
                    reject(error);
                }
            });
            let results, priceResults;
            [results, priceResults] = await Promise.all([resultsPromise, pricePromise]);
            console.log(`All queries completed in ${new Date() - start}ms`);

            const itemPrices = {};

            priceResults.forEach((resultRow) => {
                if(!itemPrices[resultRow.item_id]){
                    itemPrices[resultRow.item_id] = {
                        lastUpdated: resultRow.timestamp,
                        prices: [],
                    };
                }

                itemPrices[resultRow.item_id].prices.push(resultRow.price);
                if(itemPrices[resultRow.item_id].lastUpdated.getTime() < resultRow.timestamp.getTime()){
                    itemPrices[resultRow.item_id].lastUpdated = resultRow.timestamp;
                    itemPrices[resultRow.item_id].lastLowPrice = resultRow.price;

                    return;
                }

                if(itemPrices[resultRow.item_id].lastUpdated.getTime() === resultRow.timestamp.getTime()){
                    if(itemPrices[resultRow.item_id].lastLowPrice > resultRow.price){
                        itemPrices[resultRow.item_id].lastLowPrice = resultRow.price;
                    }
                }
            });

            for(const [itemId, result] of results){
                itemPrices[result.id]?.prices.sort();
                result.avg24hPrice = getPercentile(itemPrices[result.id]?.prices || []);
                result.low24hPrice = itemPrices[result.id]?.prices[0];
                result.high24hPrice = itemPrices[result.id]?.prices[itemPrices[result.id]?.prices.length - 1];
                result.lastLowPrice = itemPrices[result.id]?.lastLowPrice;
                result.updated = itemPrices[result.id]?.lastUpdated || result.last_update;
                results.set(itemId, result);
            }
            return results;
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
            return;
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
                changeValues[property]  = value;
            }
        }
        if (Object.keys(changeValues) === 0) {
            return;
        }
        console.log(`Setting ${id} properties to`, changeValues);
        const propertyNames = [];
        const propertyValues = [];
        for (const property in changeValues) {
            if (property === 'properties') {
                currentItemData[property] = properties[property];
            } else {
                currentItemData[property] = changeValues[property];
            }
            propertyNames.push(`${property} = ?`);
            propertyValues.push(changeValues[property])
        }
        myData.set(id, currentItemData);
        return query(`UPDATE item_data SET ${propertyNames.join(', ')} WHERE id = ?`, [...propertyValues, id]);
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
            }
            if (insertResult.affectedRows > 0) {
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