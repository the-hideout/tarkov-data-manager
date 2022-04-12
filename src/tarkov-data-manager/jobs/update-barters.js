const fs = require('fs');
const path = require('path');

const got = require('got');
const cheerio = require('cheerio');

const cloudflare = require('../modules/cloudflare');
const oldNames = require('../old-names.json');
const fixName = require('../modules/wiki-replacements');
const JobLogger = require('../modules/job-logger');

const { query, jobComplete } = require('../modules/db-connection');

let itemData = false;
const TRADES_URL = 'https://escapefromtarkov.gamepedia.com/Barter_trades';
let logger;
let trades;
let tasks;
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
        logger.warn(`Found no item called "${name}"`);

        return false;
    }

    if (!item.attributes) item.attributes = [];

    if (item.name === 'Dogtag') {
        let dogtagName = fixName($local('a').eq(-1).text());
        let minLevelMatch = dogtagName.match(/ ≥ Lvl (\d+)/);
        if (minLevelMatch) {
            item.attributes.push({
                type: 'minLevel',
                value: minLevelMatch[1]
            });
        }
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
        attributes: item.attributes
    };
};

const parseTradeRow = (tradeElement) => {
    const $trade = $(tradeElement);
    const rewardItemName = fixName($trade.find('th').eq(-1).find('a').eq(0).prop('title'));
    const traderRequirement = fixName($trade.find('th').eq(2).find('a').eq(1).text());
    const rewardItem = getItemByName(rewardItemName);

    if(!rewardItem){
        //console.log(`Found no item called "${rewardItemName}"`);
        logger.error(`Found no item called "${rewardItemName}"`);

        return true;
    }
    //logger.log(`Parsing ${rewardItem.name} (${traderRequirement})`);

    const tradeData = {
        requiredItems: [],
        rewardItems: [{
            name: rewardItem.name,
            id: rewardItem.id,
            count: 1,
        }],
        trader: traderRequirement,
        requirements: [],
        sourceName: fixName($trade.find('th').eq(2).find('a').eq(0).prop('title')).toLowerCase()
    };
    const loyaltyLevelMatch = traderRequirement.match(/ LL(\d)/);
    if (loyaltyLevelMatch) {
        tradeData.requirements.push({
            type: 'loyaltyLevel',
            value: loyaltyLevelMatch[1]
        });
    }
    if ($trade.find('th').eq(2).find('a').length > 2 && $trade.find('th').eq(2).text().includes('task')) {
        const taskUrl = $trade.find('th').eq(2).find('a').eq(2).prop('href');
        const taskName = $trade.find('th').eq(2).find('a').eq(2).prop('title');
        for (const i in tasks) {
            const task = tasks[i];
            if (task.wiki.endsWith(taskUrl)) {
                tradeData.requirements.push({
                    type: 'questCompleted',
                    value: task.id
                });
                //console.log(`Matched quest ${taskName}: ${task.title} (${task.id})`);
                break;
            }
            if (taskName == task.title) {
                logger.warn(`Found potential quest match for ${taskName}: ${task.title} (${task.id})`);
                logger.warn(`${taskUrl} != ${task.wiki}`);
            }
        }
    }

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
                attributes: requiredItem.attributes
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
                attributes: requiredItem.attributes
            };
        });

        trades.data.push(bearTrade);
    } else {
        trades.data.push(tradeData);
    }

    return true;
}

module.exports = async function() {
    logger = new JobLogger('update-barters');
    try {
        logger.log('Retrieving barters data...');
        const itemsPromise = query('SELECT * FROM item_data ORDER BY id');
        const translationsPromise = query(`SELECT item_id, type, value FROM translations WHERE language_code = ?`, ['en']);
        const wikiPromise = got(TRADES_URL);
        const tasksPromise = got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/quests.json', {
            responseType: 'json',
        });
        const allResults = await Promise.all([itemsPromise, translationsPromise, wikiPromise, tasksPromise]);
        const results = allResults[0];
        const translationResults = allResults[1];
        const wikiResponse = allResults[2];
        tasks = allResults[3].body;
        $ = cheerio.load(wikiResponse.body);
        trades = {
            updated: new Date(),
            data: [],
        };
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

        itemData = returnData;

        logger.succeed('Barters data retrieved');
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

        logger.log('Parsing barters table...');
        traderRows.map(parseTradeRow);
        logger.succeed('Finished parsing barters table');

        const response = await cloudflare(`/values/BARTER_DATA`, 'PUT', JSON.stringify(trades)).catch(error => {
            logger.error('Error on cloudflare put for BARTER_DATA')
            logger.error(requestError);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of BARTER_DATA');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
        }
        for (let i = 0; i < response.messages.length; i++) {
            logger.error(response.messages[i]);
        }
        
        fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'barters.json'), JSON.stringify(trades, null, 4));

        logger.succeed('Barters updated');
    } catch (error) {
        logger.error(error);
    }

    // Possibility to POST to a Discord webhook here with cron status details
    logger.end();
    await jobComplete();
};