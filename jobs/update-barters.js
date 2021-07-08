const fs = require('fs');
const path = require('path');

const got = require('got');
const cheerio = require('cheerio');
const mysql = require('mysql');

const cloudflare = require('../modules/cloudflare');
const oldNames = require('../old-names.json');
const fixName = require('../modules/wiki-replacements');

const connection = mysql.createConnection({
    host     : 'tarkov-tools-master-1.cluster-c1vhfeufwkpn.eu-west-1.rds.amazonaws.com',
    user     : 'desktop1',
    password : process.env.MYSQL_PASSWORD,
    database : 'tarkov_tools',
});

connection.connect();

let itemData = false;

const TRADES_URL = 'https://escapefromtarkov.gamepedia.com/Barter_trades';

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

    const $ = cheerio.load(html);

    let name = fixName($('a').eq(0).prop('title'));

    if(!name){
        name = fixName($('a').eq(-1).prop('title'));
    }

    const item = getItemByName(name);

    if(!item){
        console.log(`Found no item called "${name}"`);

        return false;
    }

    let count = 1;

    // Strip the links
    $('a').remove();
    const numberMatch = $.text().match(/\d+/gm);

    if(numberMatch){
        count = Number(numberMatch[0]);
    }

    return {
        name: item.name,
        id: item.id,
        count: count,
    };
};

module.exports = async function() {
    const response = await got(TRADES_URL);
    const $ = cheerio.load(response.body);
    const trades = {
        updated: new Date(),
        data: [],
    };
    const traderIndex = [
        'Prapor',
        'Therapist',
        'Skier',
        'Peacekeeper',
        'Mechanic',
        'Ragman',
        'Jaeger',
    ];

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

    $('.wikitable').each((traderTableIndex, traderTableElement) => {
        $(traderTableElement)
            .find('tr')
            .each((tradeIndex, tradeElement) => {
                if(tradeIndex === 0){
                    return true;
                }

                const $trade = $(tradeElement);
                const rewardItemName = fixName($trade.find('th').eq(-1).find('a').eq(0).prop('title'));
                const traderRequirement = fixName($trade.find('th').eq(2).find('a').eq(1).text());
                const rewardItem = getItemByName(rewardItemName);

                if(!rewardItem){
                    console.log(`Found no item called "${rewardItemName}"`);

                    return true;
                }

                const tradeData = {
                    id: `${traderTableIndex}-${tradeIndex}`,
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
                    // console.log($trade.find('th').eq(0).html());
                    // console.log(items.length, itemCountMatches);
                    // console.log();

                    return true;
                }

                tradeData.requiredItems = items.map(getItemData).filter(Boolean);

                // if(tradeData.id === '6-16'){
                //     console.log(items);
                //     console.log(tradeData);
                // }

                // Failed to map at least one item
                if(tradeData.requiredItems.length !== items.length){
                    // console.log(tradeData);
                    return true;
                }

                // Tactical sword is not in the game?
                if(tradeData.requiredItems.find((item) => {
                    return item.name.toLowerCase().includes('m-2 tactical sword');
                })) {
                    return true;
                }

                trades.data.push(tradeData);

                return true;
            });
    });

    for(const trade of trades.data){
    //     console.log(trade);
    //     await new Promise((resolve, reject) => {
    //         connection.query(`INSERT IGNORE INTO trades (id, type, source)
    //             VALUES (
    //                 '${trade.id}',
    //                 'barter',
    //                 '${trade.trader}'
    //             )`, async (error, result, fields) => {
    //                 if (error) {
    //                     return reject(error);
    //                 }

    //                 for(const requiredItem of trade.requiredItems){
    //                     await new Promise((innerResolve, innerReject) => {
    //                         connection.query(`INSERT IGNORE INTO trade_requirements (trade_id, item_id, count)
    //                             VALUES (
    //                                 '${trade.id}',
    //                                 '${requiredItem.id}',
    //                                 ${requiredItem.count}
    //                             )`, (error, result, fields) => {
    //                                 if (error) {
    //                                     innerReject(error);
    //                                 }

    //                                 innerResolve();
    //                             }
    //                         );
    //                     });
    //                 }

    //                 for(const rewardItem of trade.rewardItems){
    //                     await new Promise((innerResolve, innerReject) => {
    //                         connection.query(`INSERT IGNORE INTO trade_rewards (trade_id, item_id, count)
    //                             VALUES (
    //                                 '${trade.id}',
    //                                 '${rewardItem.id}',
    //                                 ${rewardItem.count}
    //                             )`, (error, result, fields) => {
    //                                 if (error) {
    //                                     innerReject(error);
    //                                 }

    //                                 innerResolve();
    //                             }
    //                         );
    //                     });
    //                 }

    //                 return resolve();
    //             }
    //         );
    //     });
    }

    try {
        const response = await cloudflare(`accounts/66766e138fce1ac1d2ef95953e037f4e/storage/kv/namespaces/f04e5b75ee894b3a90cec2b7cc351311/values/BARTER_DATA`, 'PUT', JSON.stringify(trades));
        console.log(response);
    } catch (requestError){
        console.error(requestError);
    }

    fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'barters.json'), JSON.stringify(trades, null, 4));

    // console.log('Now you should run')
    // console.log('wrangler kv:key put --namespace-id f04e5b75ee894b3a90cec2b7cc351311 "BARTER_DATA" ../tarkov-data-manager/scripts/barters.json --path');
    // console.log('from the data-handler repo');

    connection.end();
};