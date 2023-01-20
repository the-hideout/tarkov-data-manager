const got = require('got');
const cheerio = require('cheerio');

const cloudflare = require('../modules/cloudflare');
const oldNames = require('../old-names.json');
const fixName = require('../modules/wiki-replacements');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const { query, jobComplete } = require('../modules/db-connection');
const jobOutput = require('../modules/job-output');

let itemData = false;
let presetData;
const WIKI_URL = 'https://escapefromtarkov.fandom.com'
const TRADES_URL = `${WIKI_URL}/wiki/Barter_trades`;
let logger;
let trades;
let oldTasks;
let tasks;
let $;
let gunVariants = {};

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
    const itemArray = Object.values(itemData).filter(item => !item.types.includes('disabled'));

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

const getGunVariants = async (url) => {
    if (!gunVariants[url]) {
        gunVariants[url] = got(url, {resolveBodyOnly: true}).then(response => {
            const $gunPage = cheerio.load(response);
            const foundVariants = [];
            $gunPage('.wikitable').each((tableIndex, tableElement) => {
                const table = $(tableElement);
                if (!table.find('th').eq(1).text().toLowerCase().includes('variant')) {
                    return foundVariants;
                }
                //const variantTable = $(table);
                table.each((variantTableIndex, variantTableElement) => {
                    $(variantTableElement).find('tr').each((variantIndex, variantRow) => {
                        if (variantIndex === 0) return;
                        variantRow = $(variantRow);
                        const variant = {
                            name: variantRow.find('td').eq(1).text().trim(),
                            attachments: []
                        };
                        let img = variantRow.find('td').eq(0).find('img').eq(0).data('src');
                        if (img && img.indexOf('/revision') > -1) {
                            img = img.substring(0, img.indexOf('/revision/'));
                        }
                        variant.image = img;
                        const attachments = variantRow.find('td').eq(2).find('a');
                        for (const attachmentLink of attachments) {
                            const attachment = getItemByName($(attachmentLink).attr('title'));
                            //console.log(attachment);
                            if (attachment) {
                                variant.attachments.push(attachment.id);
                            }
                        }
                        foundVariants.push(variant);
                    });
                });
            });
            return foundVariants;
        });
    }
    return gunVariants[url];
};

const getPresetByVariant = (baseItem, variant) => {
    if (variant.name) {
        const preset = getPresetbyShortName(variant.name);
        if (preset) {
            return preset;
        }
    }
    const attachments = variant.attachments;
    for (const presetId in presetData) {
        const preset = presetData[presetId];
        if (preset.baseId !== baseItem.id) continue;
        if (preset.containsItems.length - 1 !== attachments.length) continue;
        const presetParts = preset.containsItems.filter(contained => contained.item.id !== baseItem.id);
        let matchedPartCount = 0;
        for (const part of presetParts) {
            let matchedPart = false;
            for (const attachmentId of attachments) {
                //console.log(attachment);
                if (attachmentId === part.item.id) {
                    matchedPart = true;
                    matchedPartCount++;
                    break;
                }
            }
            if (!matchedPart) break;
        }
        if (matchedPartCount === attachments.length) {
            //logger.warn(`Found no preset matching name ${variant.name || 'unnamed'} but matched ${preset.shortName}`);
            return preset;
        }
    }
    logger.warn(`Found no preset for ${variant.name || `Unnamed ${baseItem.shortName} preset`}`);
    return false;
};

const getPresetbyShortName = shortName => {
    for (const presetId in presetData) {
        const preset = presetData[presetId];
        if (preset.shortName === shortName) return preset;
    }
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
        let dogtagParts = dogtagText.match(/Dogtag(?: ≥ Lvl (?<level>\d+),?)?(?<faction> [\S]+)?/);
        const dogtagName = 'Dogtag'+(dogtagParts.groups.faction ? dogtagParts.groups.faction : '');
        item = getItemByName(dogtagName);
        if (item) {
            let minLevelMatch = dogtagParts.groups.level;
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
    if (rewardItem.types.includes('gun') || rewardItem.id === '5a16bb52fcdbcb001a3b00dc') {
        let gunImage = $trade.find('th').eq(-1).find('img').eq(0).data('src');
        if (gunImage && gunImage.indexOf('/revision/') > -1) {
            gunImage = gunImage.substring(0, gunImage.indexOf('/revision/'));
        }
        const gunLink = $trade.find('th').eq(-1).find('a').eq(0).prop('href');
        const wikiVariants = await getGunVariants(WIKI_URL+gunLink);
        for (const variant of wikiVariants) {
            if (variant.image !== gunImage) continue;
            const preset = getPresetByVariant(rewardItem, variant);
            if (preset) {
                rewardItem = preset;
                break;
            } else {
                logger.warn(`Matched ${gunImage} for ${rewardItem.name}, but could not match preset`);
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
        for (const task of tasks) {
            if (
                taskName.toLowerCase() === task.name.toLowerCase() ||
                task.wikiLink.endsWith(taskUrl)
                ) {
                questReq.value = task.tarkovDataId;
                questReq.stringValue = task.id;
                tradeData.taskUnlock = task.id;
                foundMatch = true;
                break;
            } 
        }
        if (!foundMatch) {
            for (const task of oldTasks) {
                if (task.wiki.endsWith(taskUrl) || taskName.toLowerCase() === task.title.toLowerCase()) {
                    questReq.value = task.id;
                    questReq.stringValue = task.gameId;
                    tradeData.taskUnlock = task.gameId;
                    break;
                }
            }
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
        const oldTasksPromise = got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/quests.json', {
            responseType: 'json',
        });
        const allResults = await Promise.all([itemsPromise, wikiPromise, oldTasksPromise]);
        const results = allResults[0];
        const wikiResponse = allResults[1];
        oldTasks = allResults[2].body;
        presetData = await jobOutput('update-presets', './cache/presets.json', logger);//JSON.parse(fs.readFileSync('./cache/presets.json'));
        tasks = await jobOutput('update-quests', './dumps/quest_data.json', logger);
        $ = cheerio.load(wikiResponse.body);
        trades = {
            updated: new Date(),
            data: [],
        };
        gunVariants = {};
        const returnData = {};
        for(const result of results){
            Reflect.deleteProperty(result, 'item_id');

            const preparedData = {
                ...result,
                types: result.types ? result.types.split(',') : []
            }

            returnData[result.id] = preparedData;
            //if (preparedData.types.includes('preset')) presetData.push(preparedData);
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

        const response = await cloudflare.put('barter_data', trades).catch(error => {
            logger.error('Error on cloudflare put for barter_data')
            logger.error(error);
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
    itemData = trades = oldTasks = tasks = $ = logger = false;
};