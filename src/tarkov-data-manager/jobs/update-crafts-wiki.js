const fs = require('fs');
const path = require('path');

const got = require('got');
const cheerio = require('cheerio');
const parseDuration = require('parse-duration');
const jsonDiff = require('json-diff');

const fixName = require('../modules/wiki-replacements');
const cloudflare = require('../modules/cloudflare');
const oldNames = require('../old-names.json');
const christmasTreeCrafts = require('../public/data/christmas-tree-crafts.json');

const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');

let itemData = false;
let logger = false;

const CRAFTS_URL = 'https://escapefromtarkov.gamepedia.com/Crafts';

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
        logger.warn(`Found no item called "${name}"`);

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
    logger = new JobLogger('update-crafts-wiki');
    try {
        const wikiResponse = await got(CRAFTS_URL);
        const $ = cheerio.load(wikiResponse.body);
        const crafts = {
            updated: new Date(),
            data: [],
        };

        let beforeData = '{}';
        try {
            beforeData = fs.readFileSync(path.join(__dirname, '..', 'dumps', 'crafts.json'));
        } catch (openError){
            // Do nothing
        }
        const results = await query('SELECT * FROM item_data ORDER BY id');
        const translationResults = await query(`SELECT item_id, type, value FROM translations WHERE language_code = ?`, ['en']);
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

        itemData =  returnData;

        $('.wikitable').each((traderTableIndex, traderTableElement) => {
            $(traderTableElement)
                .find('tr')
                .each((tradeIndex, tradeElement) => {
                    if(tradeIndex === 0){
                        return true;
                    }
    
                    const $trade = $(tradeElement);
                    const rewardItemName = fixName($trade.find('th').eq(-1).find('a').eq(0).prop('title'));
                    const rewardItem = getItemByName(rewardItemName);
    
                    if(!rewardItem){
                        logger.warn(`Found no item called "${rewardItemName}"`);
    
                        return true;
                    }
    
                    const craftData = {
                        id: `${traderTableIndex}-${tradeIndex}`,
                        requiredItems: [],
                        rewardItems: [{
                            name: rewardItem.name,
                            id: rewardItem.id,
                        }],
                        station: $trade.find('th').eq(2).find('big').text().trim(),
                    };
    
                    // Set reward count
                    $trade.find('th').eq(-1).find('a').remove();
                    craftData.rewardItems[0].count = parseInt($trade.find('th').eq(-1).text().trim().replace('x', ''));
    
                    // Set craft time
                    $trade.find('th').eq(2).find('big').remove();
                    craftData.time = $trade.find('th').eq(2).text().trim();
                    craftData.duration = parseDuration(craftData.time, 's');
    
                    let items = $trade.find('th').eq(0).html().split(/<br>\s?\+\s?<br>/);
                    const itemCountMatches = $trade.find('th').eq(0).text().match(/\sx\d/gm) || ['x1'];
    
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
    
                    craftData.requiredItems = items.map(getItemData).filter(Boolean);
    
                    // if(craftData.id === '6-16'){
                    //     console.log(items);
                    //     console.log(craftData);
                    // }
    
                    // Failed to map at least one item
                    if(craftData.requiredItems.length !== items.length){
                        logger.log(craftData);
                        return true;
                    }
    
                    // Tactical sword is not in the game?
                    if(craftData.requiredItems.find((item) => {
                        return item.name.toLowerCase().includes('m-2 tactical sword');
                    })) {
                        return true;
                    }
    
                    // Special case for water collector
                    if(craftData.station.toLowerCase().includes('water collector')){
                        craftData.requiredItems[0].count = 0.66;
                    }
    
                    crafts.data.push(craftData);
    
                    return true;
                });
        });
    
        // crafts.data = crafts.data.concat(christmasTreeCrafts);
    
        // for(const trade of crafts.data){
        //     console.log(trade);
        //     await new Promise((resolve, reject) => {
        //         connection.query(`INSERT IGNORE INTO crafts (id, type, source)
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
        // }
    
        fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'crafts-wiki.json'), JSON.stringify(crafts, null, 4));
    
        // console.log('DIFF');
        // console.log(jsonDiff.diff(JSON.parse(beforeData), crafts));
        // console.log();
        // console.log('DIFFJSON');
        // console.log(JSON.stringify(jsonDiff.diff(JSON.parse(beforeData), crafts), null, 4));
        // console.log();
        logger.log('DIFFString');
        logger.log(jsonDiff.diffString(JSON.parse(beforeData), crafts));

        const response = await cloudflare(`/values/CRAFT_DATA`, 'PUT', JSON.stringify(crafts)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of CRAFT_DATA');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                logger.error(response.messages[i]);
            }
        }
        // Possibility to POST to a Discord webhook here with cron status details
    } catch (error) {
        logger.error(error);
    }
    await jobComplete();
    logger.end();
};