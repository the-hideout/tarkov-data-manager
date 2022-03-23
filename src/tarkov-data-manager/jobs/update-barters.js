const fs = require('fs');
const path = require('path');

const got = require('got');
const cheerio = require('cheerio');

const cloudflare = require('../modules/cloudflare');
const oldNames = require('../old-names.json');
const fixName = require('../modules/wiki-replacements');

const {connection} = require('../modules/db-connection');

let itemData = false;
const TRADES_URL = 'https://escapefromtarkov.gamepedia.com/Barter_trades';
let trades;
let $;

const getItemByName = (searchName) => {
    const itemArray = Object.values(itemData);

    if(!searchName){
        return false;
    }

    let returnItem = itemArray.find((item) => {
        return item.name.toLowerCase().trim() === searchName.toLowerCase().trim();
    });

    if(returnItem){
        return returnItem;
    }

    returnItem = itemArray.find((item) => {
        return item.shortname.toLowerCase().trim() === searchName.toLowerCase().trim();
    });

    if(returnItem){
        return returnItem;
    }

    if(oldNames[searchName]){
        return itemData[oldNames[searchName]];
    }

    return itemArray.find((item) => {
        if(!item.name.includes('(')){
            return false;
        }

        const match = item.name.toLowerCase().match(/(.*)\s\(.+?$/);

        if(!match){
            return false;
        }

        return match[1].trim() === searchName.toLowerCase().trim();
    });
};

const getItemData = function getItemData(html){
    if(!html){
        return false;
    }

    const $local = cheerio.load(html);

    let name = fixName($local('a').eq(0).prop('title'));

    if(!name){
        name = fixName($local('a').eq(-1).prop('title'));
    }

    let item = getItemByName(name);

    if(!item && name === 'Dogtag'){
        let dogtagName = fixName($local('a').eq(-1).text());
        dogtagName = dogtagName.replace(/ ≥ Lvl \d+,?/, '');
        item = getItemByName(dogtagName);
    }

    if(!item && name === 'Dogtag'){
        item = {
            name: 'Dogtag',
            id: 'N/A',
        };
    }

    if(!item){
        console.log(`Found no item called "${name}"`);

        return false;
    }

    let count = 1;

    // Strip the links
    $local('a').remove();
    const numberMatch = $local.text().match(/\d+/gm);

    if(numberMatch){
        count = Number(numberMatch[0]);
    }

    return {
        name: item.name,
        id: item.id,
        count: count,
    };
};

const parseTradeRow = (tradeElement) => {
    const $trade = $(tradeElement);
    const rewardItemName = fixName($trade.find('th').eq(-1).find('a').eq(0).prop('title'));
    const traderRequirement = fixName($trade.find('th').eq(2).find('a').eq(1).text());
    const rewardItem = getItemByName(rewardItemName);

    if(!rewardItem){
        console.log(`Found no item called "${rewardItemName}"`);

        return true;
    }

    const tradeData = {
        requiredItems: [],
        rewardItems: [{
            name: rewardItem.name,
            id: rewardItem.id,
            count: 1,
        }],
        trader: traderRequirement,
    };

    let items = $trade.find('th').eq(0).html().split(/<br>\s?\+\s?<br>/);
    const itemCountMatches = $trade.find('th').eq(0).text().match(/\sx\d/gm) || ['x1'];

    if(itemCountMatches.length > items.length){
        items = $trade.find('th').eq(0).html().split(/<br><br>/);
    }

    if(itemCountMatches.length > items.length){
        items = $trade.find('th').eq(0).html().split(/\n.+?<\/a>/gm);
    }

    if(itemCountMatches.length > items.length){
        return true;
    }

    tradeData.requiredItems = items.map(getItemData).filter(Boolean);

    // Failed to map at least one item
    if(tradeData.requiredItems.length !== items.length){
        console.log(tradeData);

        return true;
    }

    // If there's an item called just "Dogtag" we want 2 different trades
    // This is not 100% correct as you can use either/or
    if(tradeData.requiredItems.find(requiredItem => requiredItem.name === 'Dogtag')){
        const usecTrade = {
            ...tradeData,
        };

        const bearTrade = {
            ...tradeData,
        };

        usecTrade.requiredItems = usecTrade.requiredItems.map(requiredItem => {
            if(requiredItem.name !== 'Dogtag'){
                return requiredItem;
            }

            const dogtagUSEC = getItemByName('Dogtag USEC');

            return {
                name: 'Dogtag USEC',
                id: dogtagUSEC.id,
                count: requiredItem.count,
            };
        });

        trades.data.push(usecTrade);

        bearTrade.requiredItems = bearTrade.requiredItems.map(requiredItem => {
            if(requiredItem.name !== 'Dogtag'){
                return requiredItem;
            }

            const dogtagBEAR = getItemByName('Dogtag BEAR');

            return {
                name: 'Dogtag BEAR',
                id: dogtagBEAR.id,
                count: requiredItem.count,
            };
        });

        trades.data.push(bearTrade);
    } else {
        trades.data.push(tradeData);
    }

    return true;
}

module.exports = async function() {
    const response = await got(TRADES_URL);
    $ = cheerio.load(response.body);
    trades = {
        updated: new Date(),
        data: [],
    };

    const promise = new Promise((resolve, reject) => {
        connection.query('SELECT * FROM item_data ORDER BY id', async (error, results) => {
            if(error){
                return reject(error);
            }

            connection.query(`SELECT item_id, type, value FROM translations WHERE language_code = ?`, ['en'], (translationQueryError, translationResults) => {
                if(translationQueryError){
                    return reject(translationQueryError);
                }
                const returnData = {};

                for(const result of results){
                    Reflect.deleteProperty(result, 'item_id');

                    const preparedData = {
                        ...result,
                    }

                    for(const translationResult of translationResults){
                        if(translationResult.item_id !== result.id){
                            continue;
                        }

                        preparedData[translationResult.type] = translationResult.value;
                    }

                    returnData[result.id] = preparedData;
                }

                return resolve(returnData);
            });
        });
    });

    itemData = await promise;

    // itemData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'all-en.json')));

    const traderRows = [];

    $('.wikitable').each((traderTableIndex, traderTableElement) => {
        $(traderTableElement)
            .find('tr')
            .each((tradeIndex, tradeElement) => {
                if(tradeIndex === 0){
                    return true;
                }

                traderRows.push(tradeElement);
            });
    });

    traderRows.map(parseTradeRow);

    try {
        const response = await cloudflare(`/values/BARTER_DATA`, 'PUT', JSON.stringify(trades));
        console.log(response);
    } catch (requestError){
        console.error(requestError);
    }

    fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'barters.json'), JSON.stringify(trades, null, 4));

    console.log('Barters updated');
};