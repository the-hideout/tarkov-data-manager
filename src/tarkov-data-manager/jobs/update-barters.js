const got = require('got');
const cheerio = require('cheerio');

const cloudflare = require('../modules/cloudflare');
const oldNames = require('../old-names.json');
const fixName = require('../modules/wiki-replacements');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');

const { query, jobComplete } = require('../modules/db-connection');

let itemData = false;
const presetData = [];
const WIKI_URL = 'https://escapefromtarkov.fandom.com'
const TRADES_URL = `${WIKI_URL}/wiki/Barter_trades`;
let logger;
let trades;
let oldTasks;
let tasks;
let en;
let $;

const tradeMap = {
    Fence: '579dc571d53a0658a154fbec',
    Jaeger: '5c0647fdd443bc2504c2d371',
    Mechanic: '5a7c2eca46aef81a7ca2145d',
    Peacekeeper: '5935c25fb3acc3127c3d8cd9',
    Prapor: '54cb50c76803fa8b248b4571',
    Ragman: '5ac3b934156ae10c4430e83c',
    Skier: '58330581ace78e27b8b10cee',
    Therapist: '54cb57776803fa99248b456e'
};

const getItemByName = (searchName) => {
    const itemArray = Object.values(itemData);

    if(!searchName){
        return false;
    }

    let returnItem = itemArray.find((item) => {
        return item.name.toLowerCase().trim().replace(/['""]/g, '') === searchName.toLowerCase().trim().replace(/['""]/g, '');
    });

    if(returnItem){
        return returnItem;
    }

    returnItem = itemArray.find((item) => {
        return item.short_name && item.short_name.toLowerCase().trim().replace(/['""]/g, '') === searchName.toLowerCase().trim().replace(/['""]/g, '');
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

const getPresetbyShortName = shortName => {
    for (const preset of presetData) {
        if (preset.short_name === shortName) return preset;
    }
    logger.warn('Found no preset for '+shortName);
    return false;
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

    const attributes = [];

    if (name === 'Dogtag'){
        let dogtagText = fixName($local('a').eq(-1).text());
        let dogTagParts = dogtagText.match(/Dogtag(?: ≥ Lvl (?<level>\d+),?)?(?<faction> [\S]+)?/);
        const dogtagName = 'Dogtag'+(dogTagParts.groups.faction > 3 ? dogTagParts.groups.faction : '');
        item = getItemByName(dogtagName);
        if (item) {
            let minLevelMatch = dogTagParts.groups.level;
            if (minLevelMatch) {
                attributes.push({
                    type: 'minLevel',
                    value: minLevelMatch
                });
            }
        } else {
            logger.error(`Could not match dogtag for ${dogtagText}`);

        }
    }

    if(!item){
        logger.error(`Found no required item called "${name}"`);

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
        item: item.id,
        count: count,
        attributes: attributes
    };
};

const parseTradeRow = async (tradeElement) => {
    const $trade = $(tradeElement);
    const rewardItemName = fixName($trade.find('th').eq(-1).find('a').eq(0).prop('title'));
    const traderRequirement = fixName($trade.find('th').eq(2).find('a').eq(1).text());
    let rewardItem = getItemByName(rewardItemName);

    if(!rewardItem){
        logger.error(`Found no reward item called "${rewardItemName}"`);

        return true;
    }
    const baseId = rewardItem.id;
    if (rewardItem.types.includes('gun')) {
        let gunImage = $trade.find('th').eq(-1).find('img').eq(0).data('src');
        if (gunImage && gunImage.indexOf('/revision/') > -1) {
            gunImage = gunImage.substring(0, gunImage.indexOf('/revision/'));
        }
        const gunLink = $trade.find('th').eq(-1).find('a').eq(0).prop('href');
        let $gunPage = cheerio.load((await got(WIKI_URL+gunLink)).body);
        const variantRows = [];
        $gunPage('.wikitable').each((tableIndex, tableElement) => {
            table = $(tableElement);
            if (!table.find('th').eq(1).text().toLowerCase().includes('variant')) {
                return;
            }
            const variantTable = $(table);
            variantTable.each((variantTableIndex, variantTableElement) => {
                $(variantTableElement).find('tr').each((variantIndex, variantRow) => {
                    if (variantIndex === 0) return;
                    variantRows.push(variantRow);
                });
            });
        });
        for (const row of variantRows) {
            $variant = $(row);
            let img = $variant.find('td').eq(0).find('img').eq(0).data('src');
            if (img && img.indexOf('/revision') > -1) {
                img = img.substring(0, img.indexOf('/revision/'));
            }
            if (img !== gunImage) continue;
            const variantName = $variant.find('td').eq(1).text().trim();
            if (!variantName) continue;
            const preset = getPresetbyShortName(variantName);
            if (preset) {
                rewardItem = preset;
                break;
            }
        }
        if (baseId === rewardItem.id) {
            //logger.warn(`Could not find matching preset for ${gunImage}`);
        }
    }
    //logger.log(`Parsing ${rewardItem.name} (${traderRequirement})`);

    const traderName = fixName($trade.find('th').eq(2).find('a').eq(0).prop('title'));
    const tradeData = {
        requiredItems: [],
        rewardItems: [{
            name: rewardItem.name,
            item: rewardItem.id,
            baseId: baseId,
            count: 1,
        }],
        trader: traderRequirement,
        requirements: [],
        sourceName: traderName.toLowerCase(),
        trader_id: tradeMap[traderName],
        trader_name: traderName,
        level: 1,
        taskUnlock: null
    };
    const loyaltyLevelMatch = traderRequirement.match(/ LL(\d)/);
    if (loyaltyLevelMatch) {
        tradeData.requirements.push({
            type: 'loyaltyLevel',
            value: parseInt(loyaltyLevelMatch[1])
        });
        tradeData.level = parseInt(loyaltyLevelMatch[1]);
    }
    tradeData.source = `${traderName} LL${tradeData.level}`;
    if ($trade.find('th').eq(2).find('a').length > 2 && $trade.find('th').eq(2).text().includes('task')) {
        const taskUrl = $trade.find('th').eq(2).find('a').eq(2).prop('href');
        const taskName = $trade.find('th').eq(2).find('a').eq(-1).prop('title');
        let foundMatch = false;
        const questReq = {
            type: 'questCompleted',
            value: null,
            stringValue: null
        };
        for (const task of oldTasks) {
            if (task.wiki.endsWith(taskUrl)) {
                questReq.value = task.id;
                foundMatch = true;
            } else if (taskName.toLowerCase() == task.title.toLowerCase()) {
                questReq.value = task.id;
                foundMatch = true;
            }
            if (foundMatch) break;
        }
        foundMatch = false;
        for (const taskId in tasks) {
            const task = tasks[taskId];
            if (taskName.toLowerCase() == task.QuestName.toLowerCase()) {
                questReq.stringValue = task._id;
                tradeData.taskUnlock = task._id;
                foundMatch = true;
            } else if (taskName.toLowerCase() == en.quest[taskId].name.toLowerCase()) {
                questReq.stringValue = task._id;
                tradeData.taskUnlock = task._id;
                foundMatch = true;
            }
            if (foundMatch)  break;
        }
        tradeData.requirements.push(questReq);
        if (typeof questReq.value === 'null' && typeof questReq.stringValue === 'null') {
            logger.warn(`Found no quest match for ${taskName}`);
        } else if (typeof questReq.value === 'null') {
            logger.warn(`Found no tarkovdata quest id for ${taskName}`);
        } else if (typeof questReq.stringValue === 'null') {
            logger.warn(`Found no quest id for ${taskName}`);
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
        return true;
    }

    trades.data.push(tradeData);

    return true;
}

module.exports = async function() {
    if (logger) return;
    logger = new JobLogger('update-barters');
    try {
        logger.log('Retrieving barters data...');
        const itemsPromise = query(`
            SELECT item_data.*, GROUP_CONCAT(DISTINCT types.type SEPARATOR ',') AS types
            FROM item_data
            LEFT JOIN types ON
                types.item_id = item_data.id
            GROUP BY
                item_data.id
            ORDER BY item_data.id
        `);
        const wikiPromise = got(TRADES_URL);
        const tasksPromise = tarkovChanges.quests();
        const oldTasksPromise = got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/quests.json', {
            responseType: 'json',
        });
        const enPromise = tarkovChanges.locale_en();
        const allResults = await Promise.all([itemsPromise, wikiPromise, tasksPromise, enPromise, oldTasksPromise]);
        const results = allResults[0];
        const wikiResponse = allResults[1];
        tasks = allResults[2];
        en = allResults[3];
        oldTasks = allResults[4].body;
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
                types: result.types ? result.types.split(',') : []
            }

            returnData[result.id] = preparedData;
            if (preparedData.types.includes('preset')) presetData.push(preparedData);
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
        await Promise.all(traderRows.map(parseTradeRow));
        let barterId = 1;
        for (const trade of trades.data) {
            trade.id = barterId++;
        }
        logger.succeed('Finished parsing barters table');

        const response = await cloudflare.put('barter_data', JSON.stringify(trades)).catch(error => {
            logger.error('Error on cloudflare put for barter_data')
            logger.error(requestError);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of barter data');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
        }
        for (let i = 0; i < response.messages.length; i++) {
            logger.error(response.messages[i]);
        }

        logger.succeed(`Finished processing ${trades.data.length} barters`);
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }

    // Possibility to POST to a Discord webhook here with cron status details
    logger.end();
    await jobComplete();
    itemData = trades = oldTasks = tasks = en = $ = logger = false;
};