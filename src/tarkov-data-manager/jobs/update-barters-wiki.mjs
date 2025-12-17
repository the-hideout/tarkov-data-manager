import fs from 'node:fs';
import path from 'node:path';

import got from 'got';
import * as cheerio from 'cheerio';

import remoteData from '../modules/remote-data.mjs';
import fixName from '../modules/wiki-replacements.js';
import tarkovData from '../modules/tarkov-data.mjs';
import DataJob from '../modules/data-job.mjs';
import presetData from '../modules/preset-data.mjs';

const WIKI_URL = 'https://escapefromtarkov.fandom.com'
const TRADES_URL = `${WIKI_URL}/wiki/Barter_trades`;

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

class UpdateBartersJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-barters'});
        this.kvName = 'barter_data';
    }

    run = async () => {
        this.logger.log('Retrieving barters data...');
        [this.itemData, this.$, this.oldTasks, this.items, this.presetNames] = await Promise.all([
            remoteData.get(),
            got(TRADES_URL).then(response => cheerio.load(response.body)),
            got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/quests.json', {
                responseType: 'json',
                resolveBodyOnly: true,
            }),
            tarkovData.items(),
        ]);
        this.oldNames = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'old-names.json')));
        this.presets = await presetData.getAllPresets();
        this.tasks = await this.jobManager.jobOutput('update-quests', this);
        this.barterAssort = await this.jobManager.jobOutput('update-trader-assorts', this, 'regular', true).then(assorts => {
            for (const traderId in assorts) {
                assorts[traderId] = assorts[traderId].reduce((foundBarters, offer) => {
                    if (offer.barter) {
                        foundBarters.push(offer);
                    }
                    return foundBarters;
                }, []);
            }
            return assorts;
        });
        this.gunVariants = {};

        this.logger.succeed('Barters data retrieved');
        // itemData = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'data', 'all-en.json')));

        const traderRows = [];

        this.$('.wikitable').each((traderTableIndex, traderTableElement) => {
            this.$(traderTableElement)
                .find('tr')
                .each((tradeIndex, tradeElement) => {
                    if(tradeIndex === 0){
                        return true;
                    }

                    traderRows.push(tradeElement);
                });
        });

        this.logger.log('Parsing barters table...');
        const trades = {
            Barter: (await Promise.all(traderRows.map(this.parseTradeRow))).filter(Boolean),
        }

        for (const barter of trades.Barter) {
            const matchedBarter = this.barterAssort[barter.trader_id].find(offer => {
                if (barter.level !== offer.minLevel) {
                    return false;
                }
                if (barter.rewardItems[0].item !== offer.item) {
                    return false;
                }
                if (barter.requiredItems.length !== offer.cost.length) {
                    return false;
                }
                for (const reqItem of barter.requiredItems) {
                    const requirementMatch = offer.cost.some(costItem => {
                        return costItem.item === reqItem.item && costItem.count === reqItem.count;
                    });
                    if (!requirementMatch) {
                        return false;
                    }
                }
                return true;
            });
            if (!matchedBarter) {
                //this.logger.warn('Could not find matching barter assort for:');
                //this.logger.log(JSON.stringify(barter, null, 4));
                barter.id = `${barter.rewardItems[0].item}-${barter.trader_id}-${barter.level}-${barter.requiredItems.map(req => req.item).join('-')}`;
            } else {
                barter.id = matchedBarter.id;
            }
        }
        
        this.logger.succeed(`Processed ${trades.Barter.length} barters`);

        let ammoPacks = 0;
        for (const barter of trades.Barter) {
            const rewardItem = this.itemData.get(barter.rewardItems[0].item);
            if (!rewardItem.types.includes('ammo-box')) {
                continue;
            }
            const ammoContents = this.items[rewardItem.id]._props.StackSlots[0];
            const count = ammoContents._max_count;
            const roundId = ammoContents._props.filters[0].Filter[0];
            trades.Barter.push({
                ...barter,
                id: `${barter.id}-${roundId}`,
                rewardItems: [{
                    name: rewardItem.name,
                    item: roundId,
                    baseId: roundId,
                    count: count,
                    attributes: []
                }],
            });
            ammoPacks++;
        }

        this.logger.log(`Unpacked ${ammoPacks} ammo pack barters`);

        await this.cloudflarePut(trades);
        return trades;
    }

    getItemByName = (searchName) => {
        if (!searchName){
            return false;
        }
        for (const [id, item] of this.itemData) {
            if (item.types.includes('disabled')) {
                continue;
            }
            if (item.name.toLowerCase().trim().replace(/['""]/g, '') === searchName.toLowerCase().trim().replace(/['""]/g, '')) {
                return item;
            }
        }
        for (const [id, item] of this.itemData) {
            if (item.types.includes('disabled')) {
                continue;
            }
            if (item.short_name && item.short_name.toLowerCase().trim().replace(/['""]/g, '') === searchName.toLowerCase().trim().replace(/['""]/g, '')) {
                return item;
            }
        }
        if(this.oldNames[searchName]){
            return this.itemData.get(this.oldNames[searchName]);
        }
        for (const [id, item] of this.itemData) {
            if (item.types.includes('disabled')) {
                continue;
            }
            if(!item.name.includes('(')){
                continue;
            }
            const match = item.name.toLowerCase().match(/(.*)\s\(.+?$/);
    
            if(!match){
                continue;
            }
    
            if (match[1].trim() === searchName.toLowerCase().trim()) {
                return item;
            }
        }
        return false;
    }

    getGunVariants = (url) => {
        if (!this.gunVariants[url]) {
            this.gunVariants[url] = got(url, {resolveBodyOnly: true}).then(response => {
                const $gunPage = cheerio.load(response);
                const foundVariants = [];
                $gunPage('.wikitable').each((tableIndex, tableElement) => {
                    const table = this.$(tableElement);
                    if (!table.find('th').eq(1).text().toLowerCase().includes('variant')) {
                        return foundVariants;
                    }
                    //const variantTable = $(table);
                    table.each((variantTableIndex, variantTableElement) => {
                        this.$(variantTableElement).find('tr').each((variantIndex, variantRow) => {
                            if (variantIndex === 0) return;
                            variantRow = this.$(variantRow);
                            const variant = {
                                name: variantRow.find('td').eq(1).text().trim(),
                                attachments: []
                            };
                            let img = variantRow.find('td').eq(0).find('img').eq(0).data('imageKey');
                            /*if (img && img.indexOf('/revision') > -1) {
                                img = img.substring(0, img.indexOf('/revision/'));
                            }*/
                            variant.image = img;
                            const attachments = variantRow.find('td').eq(2).find('a');
                            for (const attachmentLink of attachments) {
                                const attachment = this.getItemByName(this.$(attachmentLink).attr('title'));
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
        return this.gunVariants[url];
    }

    getPresetByVariant = (baseItem, variant) => {
        if (variant.name) {
            const preset = this.getPresetByShortName(variant.name);
            if (preset) {
                return preset;
            }
        }
        const attachments = variant.attachments;
        for (const presetId in this.presets) {
            const preset = this.presets[presetId];
            if (preset._items[0]._tpl !== baseItem.id) continue;
            if (preset._items.length - 1 !== attachments.length) continue;
            const presetParts = preset._items.filter(i => i._tpl !== baseItem.id);
            let matchedPartCount = 0;
            for (const part of presetParts) {
                let matchedPart = false;
                for (const attachmentId of attachments) {
                    //console.log(attachment);
                    if (attachmentId === part._tpl) {
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
        this.logger.warn(`Found no preset for ${variant.name || `Unnamed ${baseItem.shortName} preset`}`);
        return false;
    }

    getPresetByShortName = (shortName) => {
        for (const presetId in this.presets) {
            const item = this.itemData.get(presetId);
            if (item?.short_name === shortName) return this.presets[presetId];
        }
        return false;
    }

    getItemData = (html) => {
        if(!html){
            return false;
        }
    
        const $local = cheerio.load(html);
    
        let name = fixName($local('a').eq(0).prop('title'));
    
        if(!name){
            name = fixName($local('a').eq(-1).prop('title'));
        }
    
        let item = this.getItemByName(name);
    
        const attributes = [];
    
        if (name === 'Dogtag'){
            let dogtagText = fixName($local('a').eq(-1).text());
            let dogtagParts = dogtagText.match(/Dogtag(?: ≥ Lvl (?<level>\d+),?)?(?<faction> [\S]+)?/);
            const dogtagName = 'Dogtag'+(dogtagParts.groups.faction ? dogtagParts.groups.faction : '');
            item = this.getItemByName(dogtagName);
            if (item) {
                let minLevelMatch = dogtagParts.groups.level;
                if (minLevelMatch) {
                    attributes.push({
                        type: 'minLevel',
                        value: minLevelMatch
                    });
                }
            } else {
                this.logger.error(`Could not match dogtag for ${dogtagText}`);
    
            }
        }
    
        if(!item){
            this.logger.error(`Found no required item called "${name}"`);
    
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
    }

    parseTradeRow = async (tradeElement, tradeIndex) => {
        const $trade = this.$(tradeElement);
        const rewardItemName = fixName($trade.find('th').eq(-1).find('a').eq(0).prop('title'));
        const traderRequirement = fixName($trade.find('th').eq(2).find('a').eq(1).text());
        let rewardItem = this.getItemByName(rewardItemName);
    
        if(!rewardItem){
            this.logger.error(`Found no reward item called "${rewardItemName}"`);
    
            return false;
        }
        const baseId = rewardItem.id;
        if (rewardItem.types.includes('gun') || rewardItem.id === '5a16bb52fcdbcb001a3b00dc') {
            let gunImage = $trade.find('th').eq(-1).find('img').eq(0).data('imageKey');
            /*if (gunImage && gunImage.indexOf('/revision/') > -1) {
                gunImage = gunImage.substring(0, gunImage.indexOf('/revision/'));
            }*/
            const gunLink = $trade.find('th').eq(-1).find('a').eq(0).prop('href');
            const wikiVariants = await this.getGunVariants(WIKI_URL+gunLink);
            for (const variant of wikiVariants) {
                if (variant.image !== gunImage) continue;
                const preset = this.getPresetByVariant(rewardItem, variant);
                if (preset) {
                    rewardItem = preset;
                    break;
                } else {
                    this.logger.warn(`Matched ${gunImage} for ${rewardItem.name}, but could not match preset`);
                }
            }
            if (baseId === rewardItem.id) {
                //this.logger.warn(`Could not find matching preset for ${gunImage}`);
                // If no variants match, assume it's the default preset
                for (const preset of (Object.values(this.presets))) {
                    if (preset._items[0]._tpl === rewardItem.id && preset._encyclopedia === preset._items[0]._tpl) {
                        rewardItem = preset;
                        break;
                    }
                }
            }
        }
        //this.logger.log(`Parsing ${rewardItem.name} (${traderRequirement})`);
    
        const traderName = fixName($trade.find('th').eq(2).find('a').eq(0).prop('title'));
        const tradeData = {
            requiredItems: [],
            rewardItems: [{
                name: rewardItem.name,
                item: rewardItem.id,
                baseId: baseId,
                count: 1,
                attributes: []
            }],
            trader: traderRequirement,
            requirements: [],
            sourceName: traderName.toLowerCase(),
            trader_id: tradeMap[traderName],
            trader_name: traderName,
            level: 1,
            taskUnlock: null,
            id: tradeIndex + 1,
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
            for (const task of this.tasks) {
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
                for (const task of this.oldTasks) {
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
                this.logger.warn(`Found no quest match for ${taskName}`);
            } else if (typeof questReq.value === 'null') {
                this.logger.warn(`Found no tarkovdata quest id for ${taskName}`);
            } else if (typeof questReq.stringValue === 'null') {
                this.logger.warn(`Found no quest id for ${taskName}`);
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
            return false;
        }
    
        tradeData.requiredItems = items.map(this.getItemData).filter(Boolean);
    
        // Failed to map at least one item
        if(tradeData.requiredItems.length !== items.length){
            return false;
        }
    
        return tradeData;
    }
}

export default UpdateBartersJob;
