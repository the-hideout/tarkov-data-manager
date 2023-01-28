const fs = require('fs');
const path = require('path');

const got = require('got');

const remoteData = require('../modules/remote-data');
const tarkovData = require('../modules/tarkov-data');
const { setLocales, getTranslations, addTranslations } = require('../modules/get-translation');
const normalizeName = require('../modules/normalize-name');
const DataJob = require('../modules/data-job');

class UpdateQuestsJob extends DataJob {
    constructor() {
        super('update-quests');
        this.kvName = 'quest_data';
    }

    async run() {
        this.logger.log('Processing quests...');
        this.logger.log('Retrieving TarkovTracker quests.json...');
        this.tdQuests = await got('https://tarkovtracker.github.io/tarkovdata/quests.json', {
            responseType: 'json',
            resolveBodyOnly: true,
        });
        const oldQuests = await got('https://dev.sp-tarkov.com/SPT-AKI/Server/raw/commit/4e0192f21ed557b78d3e65a1c7c5f380c0dcfa96/project/assets/database/templates/quests.json', {
            responseType: 'json',
            resolveBodyOnly: true,
        });
        const data = await tarkovData.quests(true);
        this.items = await tarkovData.items();
        this.locales = await tarkovData.locales();
        this.maps = await this.jobManager.jobOutput('update-maps', this);
        this.hideout = await this.jobManager.jobOutput('update-hideout', this);
        const traders = await this.jobManager.jobOutput('update-traders', this);
        this.traderIdMap = {};
        for (const trader of traders) {
            this.traderIdMap[trader.tarkovDataId] = trader.id;
        }
        setLocales(this.locales);
        this.itemMap = await this.jobManager.jobOutput('update-item-cache', this);
        const itemResults = await remoteData.get();
        const questItemMap = new Map();
        for (const [id, item] of itemResults) {
            if (item.types.includes('quest')) {
                questItemMap.set(id, item);
            }
        }
        this.missingQuests = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'missing_quests.json')));
        this.changedQuests = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'changed_quests.json')));
        const removedQuests = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'removed_quests.json')));
        try {
            this.presets = await this.jobManager.jobOutput('update-presets', this, true);
        } catch (error) {
            this.logger.error(error);
        }
        this.tdMatched = [];
        this.questItems = {};
        const quests = {
            Task: [],
        };
        for (const questId in data) {
            if (removedQuests[questId]) continue;
            quests.Task.push(this.formatRawQuest(data[questId]));
        }
        
        for (const questId in this.missingQuests) {
            const quest = this.missingQuests[questId];
            for (const q of quests.Task) {
                if (q.id === quest.id) {
                    continue;
                }
            }
            this.logger.warn(`Adding missing quest ${quest.name} ${quest.id}...`);
            quest.locale = getTranslations({name: `${questId} name`}, this.logger);
            quest.wikiLink = `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(this.locales.en[`${questId} name`].replaceAll(' ', '_'))}`;
            for (const obj of quest.objectives) {
                obj.locale = getTranslations({description: obj.id}, this.logger);
                if (obj.type.endsWith('QuestItem')) {
                    this.questItems[obj.item_id] = {
                        id: obj.item_id
                    };
                }
                this.addMapFromDescription(obj);
            }
            for (const tdQuest of this.tdQuests) {
                if (quest.id == tdQuest.gameId || quest.name === tdQuest.title) {
                    quest.tarkovDataId = tdQuest.id;
                    this.tdMatched.push(tdQuest.id);
                    this.mergeTdQuest(quest, tdQuest);
                    break;
                }
            }
            quests.Task.push(quest);
        }

        for (const oldQuestId in oldQuests) {
            const foundQuest = quests.Task.find(q => q.id === oldQuestId);
            if (!foundQuest && !removedQuests[oldQuestId]) {
                this.logger.warn(`Old quest ${this.locales.en[`${oldQuestId} name`]} ${oldQuestId} is missing from current quests`);
                quests.Task.push(this.formatRawQuest(oldQuests[oldQuestId]));
                continue;
            }
        }

        for (const tdQuest of this.tdQuests) {
            try {
                if (tdQuest.gameId && removedQuests[tdQuest.gameId]) continue;
                if (!this.tdMatched.includes(tdQuest.id)) {
                    this.logger.warn(`Adding TarkovData quest ${tdQuest.title} ${tdQuest.id}...`);
                    if (!this.tdTraders) {
                        this.logger.log('Retrieving TarkovTracker traders.json...');
                        this.tdTraders = (await got('https://github.com/TarkovTracker/tarkovdata/raw/master/traders.json', {
                            responseType: 'json',
                        })).body;
                        this.logger.log('Retrieving TarkovTracker maps.json...');
                        this.tdMaps = (await got('https://github.com/TarkovTracker/tarkovdata/raw/master/maps.json', {
                            responseType: 'json',
                        })).body;
                    }
                    quests.Task.push(this.formatTdQuest(tdQuest));
                }
            } catch (error) {
                this.logger.error('Error processing missing TarkovData quests');
                this.logger.error(error);
            }
        }
        this.logger.log('Finished processing TarkovData quests');

        // add start, success, and fail message ids
        // validate task requirements

        const getMinPlayerLevelForTraderLevel = (traderId, traderLevel) => {
            const trader = traders.find(tr => tr.id === traderId);
            if (!trader) {
                return 0;
            }
            const tLevel = trader.levels.find(lvl => lvl.level === traderLevel);
            if (!tLevel) {
                return 0;
            }
            return tLevel.requiredPlayerLevel;
        };
        const getQuestMinLevel = (questId, isPrereq = false) => {
            const quest = quests.Task.find(q => q.id === questId);
            if (!quest) {
                return 0;
            }
            let actualMinLevel = quest.minPlayerLevel;
            for (const req of quest.traderLevelRequirements) {
                const traderMinPlayerLevel = getMinPlayerLevelForTraderLevel(req.trader_id, req.level);
                if (traderMinPlayerLevel > actualMinLevel) {
                    actualMinLevel = traderMinPlayerLevel;
                }
            }
            if (isPrereq) {
                for (const obj of quest.objectives) {
                    if (obj.type !== 'traderLevel') {
                        continue;
                    }
                    const traderMinPlayerLevel = getMinPlayerLevelForTraderLevel(obj.trader_id, obj.level);
                    if (traderMinPlayerLevel > actualMinLevel) {
                        actualMinLevel = traderMinPlayerLevel;
                    }
                }
            }
            for (const req of quest.taskRequirements) {
                const reqMinLevel = getQuestMinLevel(req.task, true);
                if (reqMinLevel > actualMinLevel) {
                    actualMinLevel = reqMinLevel;
                }
            }
            return actualMinLevel;
        };

        for (const quest of quests.Task) {
            /*quest.descriptionMessageId = this.locales.en.quest[quest.id]?.description;
            quest.startMessageId = this.locales.en.quest[quest.id]?.startedMessageText;
            quest.successMessageId = this.locales.en.quest[quest.id]?.successMessageText;
            quest.failMessageId = this.locales.en.quest[quest.id]?.failMessageText;*/
            quest.normalizedName = normalizeName(quest.name)+(quest.factionName !== 'Any' ? `-${normalizeName(quest.factionName)}` : '');

            const removeReqs = [];
            for (const req of quest.taskRequirements) {
                const questIncluded = quests.Task.some(q => q.id === req.task);
                if (questIncluded) {
                    continue;
                }
                this.logger.warn(`${quest.locale.en.name} (${quest.id}) task requirement ${req.name} (${req.task}) is not a valid task`);
                removeReqs.push(req.task);
            }
            quest.taskRequirements = quest.taskRequirements.filter(req => !removeReqs.includes(req.task));

            quest.minPlayerLevel = getQuestMinLevel(quest.id);
        }

        const ignoreQuests = [
            '5d25dae186f77443e55d2f78',
            '61bb475467f83663e155e26a',
            '61bb468b8d7cac1532300ccc',
            '61bb47481908c67d4249a205',
            '61bb474b1ab5304c3817a53a',
            '61bb474f8b8d2a79d012cd6e',
            '61bb474dce7374453b45dfd2',
            '61bb47516b70332c062ca7b9',
            '61bb47578d7cac1532300ccd',
            '61bb4756883b2c16a163870a',
            '61bfa784f4378605ca5598e1',
        ];
        for (const key in this.locales.en) {
            const match = key.match(/(?<id>[a-f0-9]{24}) name/);
            if (!match) {
                continue;
            }
            const questId = match.groups.id;
            let found = false;
            for (const quest of quests.Task) {
                if (questId === quest.id) {
                    found = true;
                    break;
                };
            }
            if (found || ignoreQuests.includes(questId)) continue;
            if (!this.locales.en[`${questId} name`]) {
                continue;
            }
            if (removedQuests[questId]) {
                this.logger.warn(`Quest ${this.locales.en[`${questId} name`]} ${questId} has been removed`);
                continue;
            }
            this.logger.warn(`No quest data found for ${this.locales.en[`${questId} name`]} ${questId}`);
        }

        for (const id in this.questItems) {
            if (this.items[id]) {
                //all quest items have a yellow background
                //questItems[id].backgroundColor = items[id]._props.BackgroundColor;
                this.questItems[id].width = this.items[id]._props.Width;
                this.questItems[id].height = this.items[id]._props.Height;
                this.questItems[id].locale = getTranslations({
                    name: `${id} Name`,
                    shortName: `${id} ShortName`,
                    description: `${id} Description`
                }, this.logger);
            }
            if (questItemMap.has(id)) {
                const itemData = questItemMap.get(id);
                this.questItems[id].iconLink = itemData.icon_link || 'https://assets.tarkov.dev/unknown-item-icon.jpg';
                this.questItems[id].gridImageLink = itemData.grid_image_link || 'https://assets.tarkov.dev/unknown-item-grid-image.jpg';
                this.questItems[id].baseImageLink = itemData.base_image_link || 'https://assets.tarkov.dev/unknown-item-base-image.png';
                this.questItems[id].inspectImageLink = itemData.image_link || 'https://assets.tarkov.dev/unknown-item-inspect.webp';
                this.questItems[id].image512pxLink = itemData.image_512_link || 'https://assets.tarkov.dev/unknown-item-512.webp';
                this.questItems[id].image8xLink = itemData.image_8x_link || 'https://assets.tarkov.dev/unknown-item-512.webp';
            } else {
                this.logger.warn(`Quest item ${id} not found in DB`);
            }
            this.questItems[id].normalizedName = normalizeName(this.questItems[id].locale.en.name);
        }

        quests.QuestItem = this.questItems;

        quests.Quest = await this.jobManager.runJob('update-quests-legacy', {data: this.tdQuests, parent: this});

        await this.cloudflarePut(quests);
        this.logger.success(`Finished processing ${quests.Task.length} quests`);
        return quests;
    }

    getMapFromNameId = nameId => {
        for (const map of this.maps) {
            if (map.nameId === nameId) {
                return map;
            }
        }
        this.logger.error(`Could not find map with nameId ${nameId}`);
        return false;
    }

    getTdLocation = id => {
        for (const name in this.tdMaps) {
            const map = this.tdMaps[name];
            if (map.id === id) return map.locale.en;
        }
    }

    descriptionMentionsMap = desc => {
        if (!desc) return false;
        const onMapRegex = new RegExp(`on (?<mapName>${this.maps.map(m => m.name).join('|')})`);
        //console.log(onMapRegex)
        const match = desc.match(onMapRegex);
        if (match) {
            for(const map of this.maps) {
                if (map.name === match.groups.mapName) {
                    return map;
                }
            }
            this.logger.warn(`Map ${match.groups.mapName} not found in maps`);
        }
        return false;
    }

    addMapFromDescription = obj => {
        if (obj.locationNames.length > 0) return;
        const foundMap = this.descriptionMentionsMap(obj.description);
        if (!foundMap) return;
        obj.locationNames.push(foundMap.name);
        obj.map_ids.push(foundMap.id);
    }

    getRewardItems = (reward) => {
        const rewardData = {
            item: reward.items[0]._tpl,
            item_name: this.locales.en[`${reward.items[0]._tpl} Name`],
            count: 1,
            contains: [],
            attributes: []
        };
        if (reward.items[0].upd && reward.items[0].upd.StackObjectsCount) {
            rewardData.count = reward.items[0].upd.StackObjectsCount;
        }
        for (let i = 1; i < reward.items.length; i++) {
            const item = reward.items[i];
            const containedItem = {
                item: item._tpl,
                name: this.locales.en[`${item._tpl} Name`],
                slot: item.slotId,
                count: 1
            };
            if (item.upd) {
                containedItem.count = item.upd.StackObjectsCount;
            }
            rewardData.contains.push(containedItem);
        }
        for (const presetId in this.presets) {
            const preset = this.presets[presetId];
            if (preset.default) continue;
            if (preset.baseId !== rewardData.item) continue;
            if (!preset.containsItems.length == rewardData.contains.length+1) continue;
            let matchingParts = 1;
            for (let i = 1; i < preset.containsItems.length; i++) {
                const presetPart = preset.containsItems[i];
                for (const rewardPart of rewardData.contains) {
                    if (rewardPart.item === presetPart.item.id) {
                        matchingParts++;
                        break;
                    }
                }
            }
            if (matchingParts == preset.containsItems.length) {
                this.logger.success('successfully matched '+preset.name);
                rewardData.item = preset.id;
                rewardData.item_name = preset.name;
                rewardData.base_item_id = preset.baseId;
                rewardData.contains = [];
                for (const part of preset.containsItems) {
                    rewardData.contains.push({
                        item: part.item.id,
                        name: part.item.name,
                        count: part.count
                    });
                }
                break;
            }
        }
        return rewardData;
    }

    loadRewards = (questData, rewardsType, sourceRewards) => {
        for (const reward of sourceRewards) {
            if (reward.type === 'Experience') {
                questData.experience = parseInt(reward.value);
            } else if (reward.type === 'TraderStanding') {
                questData[rewardsType].traderStanding.push({
                    trader_id: reward.target,
                    name: this.locales.en[`${reward.target} Nickname`],
                    standing: parseFloat(reward.value)
                });
            } else if (reward.type === 'Item') {
                questData[rewardsType].items.push(this.getRewardItems(reward));
            } else if (reward.type === 'AssortmentUnlock') {
                if (!this.locales.en[`${reward.items[0]._tpl} Name`]) {
                    this.logger.warn(`No name found for unlock item "${reward.items[0]._tpl}" for completion reward ${reward.id} of ${questData.name}`);
                    continue;
                }
                let unlock = {
                    id: reward.id,
                    trader_id: reward.traderId,
                    trader_name: this.locales.en[`${reward.traderId} Nickname`],
                    level: reward.loyaltyLevel,
                    /*item_id: reward.items[0]._tpl,
                    item_name: en.templates[reward.items[0]._tpl].Name,
                    item_contains: []*/
                };
                /*for (let i = 1; i < reward.items.length; i++) {
                    const item = reward.items[i];
                    unlock.item_contains.push({
                        id: item._tpl,
                        name: en.templates[item._tpl].Name,
                        slot: item.slotId
                    });
                }*/
                unlock = {
                    ...unlock,
                    ...this.getRewardItems(reward)
                };
                questData[rewardsType].offerUnlock.push(unlock);
            } else if (reward.type === 'Skill') {
                const skillLevel = {
                    name: this.locales.en[reward.target],
                    level: parseInt(reward.value) / 100,
                    locale: getTranslations({name: lang => {
                        return lang[reward.target] || reward.target;
                    }}, this.logger)
                };
                questData[rewardsType].skillLevelReward.push(skillLevel);
            } else if (reward.type === 'TraderUnlock') {
                questData[rewardsType].traderUnlock.push({
                    trader_id: reward.target,
                    trader_name: this.locales.en[`${reward.target} Nickname`]
                });
            } else if (reward.type === 'ProductionScheme') {
                const station = this.hideout.find(s => s.areaType == reward.traderId);
                if (!station) {
                    this.logger.warn(`Unrecognized hideout area type "${reward.traderId}" for ${rewardsType} reward ${reward.id} of ${questData.name}`);
                    continue;
                }
                questData[rewardsType].craftUnlock.push({
                    items: reward.items.map(item => {
                        return {
                            id: item._tpl,
                            name: this.locales.en[`${item._tpl} Name`],
                            count: item.upd?.StackObjectsCount || 1,
                        }
                    }),
                    station_id: station.id,
                    station_name: station.name,
                    level: reward.loyaltyLevel,
                });
            } else {
                this.logger.warn(`Unrecognized reward type "${reward.type}" for ${rewardsType} reward ${reward.id} of ${questData.name}`);
            }
        }
    }

    mergeTdQuest = (questData, tdQuest) => {
        if (!tdQuest) {
            for (const q of this.tdQuests) {
                if (q.id === questData.tarkovDataId) {
                    tdQuest = q;
                    break;
                }
            }
        }
        if (!tdQuest) return;
        for (const tdObj of tdQuest.objectives) {
            if (tdObj.type === 'key') {
                const key = {
                    key_ids: [tdObj.target]
                };
                if (Array.isArray(tdObj.target)) key.key_ids = tdObj.target;
                key.locationName = null;
                key.map_id = null;
                if (tdObj.location > -1) {
                    key.locationName = this.getTdLocation(tdObj.location);
                    key.map_id = tdObj.location;
                }
                questData.neededKeys.push(key);
            }
        }
    }

    formatTdQuest = (quest) => {
        const questData = {
            id: quest.gameId,
            name: quest.title,
            trader: this.traderIdMap[quest.giver],
            //traderName: this.traderIdMap[quest.giver],
            location_id: null,
            locationName: null,
            wikiLink: quest.wiki,
            minPlayerLevel: quest.require.level,
            taskRequirements: [],
            traderLevelRequirements: [],
            objectives: [],
            startRewards: {
                traderStanding: [],
                items: [],
                offerUnlock: [],
                skillLevelReward: [],
                traderUnlock: [],
                craftUnlock: [],
            },
            finishRewards: {
                traderStanding: [],
                items: [],
                offerUnlock: [],
                skillLevelReward: [],
                traderUnlock: [],
                craftUnlock: [],
            },
            experience: quest.exp,
            tarkovDataId: quest.id,
            factionName: 'Any',
            neededKeys: []
        };
        for (const tdId of quest.require.quests) {
            for (const preQuest of this.tdQuests) {
                if (preQuest.id === tdId) {
                    if (preQuest.gameId) {
                        questData.taskRequirements.push({
                            task: preQuest.gameId,
                            name: this.locales.en[`${preQuest.gameId} name`],
                            status: ['complete']
                        });
                    } else {
                        this.logger.warn(`No gameId found for prerequisite quest ${preQuest.title} ${tdId}`);
                    }
                    break;
                }
            }
        }
        for (const id of quest.unlocks) {
            questData.finishRewards.offerUnlock.push({
                id: `${id}-unlock`,
                trader_id: this.traderIdMap[quest.giver],
                level: null,
                item: id,
                count: 1,
                contains: [],
                attributes: []
            })
        }
        for (const rep of quest.reputation) {
            questData.finishRewards.traderStanding.push({
                trader_id: this.traderIdMap[rep.trader],
                //name: en.trading[reward.target].Nickname,
                standing: rep.rep
            });
        }
        for (const objective of quest.objectives) {
            const obj = {
                id: objective.id,
                type: null,
                optional: false,
                description: '',
                locationNames: [],
                map_ids: []
            };
            const idPattern = /^[a-z0-9]{24}$/
            if (objective.location > -1) {
                obj.locationNames.push(this.getTdLocation(objective.location))
                obj.map_ids.push(objective.location);
            }
            if (objective.type === 'find' || objective.type === 'collect' || objective.type === 'pickup') {
                // find is find in raid, collect is not FIR
                // pickup is quest item
                obj.count = objective.number;
                if (objective.type === 'pickup') {
                    obj.type = `findQuestItem`;
                    obj.item_id = objective.target;
                    this.questItems[obj.target] = {
                        id: obj.target,
                        locale: {
                            en: {
                                name: obj.target
                            }
                        }
                    };
                    obj.description = `Obtain ${objective.target}`;
                } else {
                    obj.type = `findItem`;
                    obj.item_id = objective.target;
                    obj.item_name = this.locales.en[`${objective.target} Name`];
                    obj.item = objective.target;
                    obj.dogTagLevel = 0;
                    obj.maxDurability = 0;
                    obj.minDurability = 100;
                    obj.foundInRaid = objective.type === 'find';
                    obj.description = `Find ${this.locales.en[`${objective.target} Name`]}`;
                }
                if (objective.hint) obj.description += ` ${objective.hint}`;
            } else if (objective.type === 'kill') {
                obj.type = 'shoot';
                obj.description = `Kill ${objective.target}`;
                if (objective.with) {
                    obj.description += ` with ${objective.with.join(', ')}`;
                }
                obj.target = objective.target;
                obj.count = parseInt(objective.number);
                obj.shotType = 'kill';
                obj.bodyParts = [];
                obj.usingWeapon = [];
                obj.usingWeaponMods = [];
                obj.zoneNames = [];
                obj.distance = null;
                obj.wearing = [];
                obj.notWearing = [];
                obj.healthEffect = null;
                obj.enemyHealthEffect = null;
            } else if (objective.type === 'locate') {
                obj.type = 'visit';
                obj.description = `Locate ${objective.target}`;
            } else if (objective.type === 'place') {
                obj.count = parseInt(objective.number);
                if (!objective.target.match(idPattern)) {
                    obj.type = 'plantQuestItem';
                    obj.item_id = obj.target;
                    this.questItems[obj.target] = {
                        id: obj.target,
                        locale: {
                            en: {
                                name: obj.target
                            }
                        }
                    };
                } else {
                    obj.type = 'plantItem';
                    obj.item = objective.target;
                    obj.item_name = this.locales.en[`${objective.target} Name`];
                    obj.dogTagLevel = 0;
                    obj.maxDurability = 100;
                    obj.minDurability = 0;
                    obj.foundInRaid = false;
                }
                obj.description = `Place ${this.locales.en[`${objective.target} Name`]}`;
                if (objective.hint) obj.description += ` at ${objective.hint}`;
            } else if (objective.type === 'mark') {
                obj.type = 'mark';
                obj.item = objective.target;
                obj.item_id = objective.target;
                obj.item_name = this.locales.en[`${objective.target} Name`];
            } else if (objective.type === 'skill') {
                obj.type = 'skill';
                obj.skillLevel = {
                    name: objective.target,
                    level: objective.number
                };
            } else if (objective.type === 'reputation') {
                obj.type = 'traderLevel';
                obj.trader_id = this.traderIdMap[objective.target];
                //obj.trader_name = en.trading[objective._props.target].Nickname;
                obj.level = objective.number;
            } else if (objective.type === 'key') {
                key = {
                    key_ids: [objective.target]
                };
                if (Array.isArray(objective.target)) key.key_ids = objective.target;
                key.locationName = null;
                key.map_id = null;
                if (objective.location > -1) {
                    key.locationName = this.getTdLocation(objective.location);
                    key.map_id = objective.location;
                }
                questData.neededKeys.push(key);
            }
            questData.objectives.push(obj);
        }
        return questData;
    }

    formatRawQuest = (quest) => {
        const questId = quest._id;
        this.logger.log(`Processing ${this.locales.en[`${questId} name`]} ${questId}`);
        /*if (!en.locations[quest.location]) {
            this.logger.warn(`Could not find location name for ${quest.location} of ${en.quest[questId].name}`);
            continue;
        }*/
        let locationName = 'any';
        let locationId = null;
        if (quest.location !== 'any') {
            locationName = this.locales.en[`${quest.location} Name`];
            locationId = quest.location;
        }
        const questData = {
            id: questId,
            name: this.locales.en[`${questId} name`],
            trader: quest.traderId,
            traderName: this.locales.en[`${quest.traderId} Nickname`],
            location_id: locationId,
            locationName: locationName,
            wikiLink: `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(this.locales.en[`${questId} name`].replaceAll(' ', '_'))}`,
            minPlayerLevel: 0,
            taskRequirements: [],
            traderLevelRequirements: [],
            objectives: [],/*{
                findItem: [],
                findQuestItem: [],
                giveItem: [],
                giveQuestItem: [],
                visit: [],
                extract: [],
                shoot: [],
                mark: [],
                plantItem: [],
                plantQuestItem: [],
                skill: [],
                gunsmith: [],
                traderLevel: [],
                quest: [],
                level: [],
                experience: []
            },*/
            startRewards: {
                traderStanding: [],
                items: [],
                offerUnlock: [],
                skillLevelReward: [],
                traderUnlock: [],
                craftUnlock: [],
            },
            finishRewards: {
                traderStanding: [],
                items: [],
                offerUnlock: [],
                skillLevelReward: [],
                traderUnlock: [],
                craftUnlock: [],
            },
            experience: 0,
            tarkovDataId: undefined,
            factionName: 'Any',
            neededKeys: [],
            locale: getTranslations({name: `${questId} name`}, this.logger)
        };
        for (const objective of quest.conditions.AvailableForFinish) {
            if (this.changedQuests[questData.id]?.objectivesRemoved?.includes(objective._props.id)) {
                continue;
            }
            let objectiveId = objective._props.id;
            if (this.changedQuests[questData.id]?.objectiveIdsChanged && this.changedQuests[questData.id]?.objectiveIdsChanged[objectiveId]) {
                objectiveId = this.changedQuests[questData.id]?.objectiveIdsChanged[objectiveId];
            }
            let optional = false;
            if (objective._props.parentId) {
                optional = true;
            }
            const obj = {
                id: objectiveId,
                type: null,
                optional: optional,
                locationNames: [],
                map_ids: [],
                locale: getTranslations({description: objectiveId}, this.logger, false)
            };
            if (objective._parent === 'FindItem' || objective._parent === 'HandoverItem') {
                const targetItem = this.items[objective._props.target[0]];
                let verb = 'give';
                if (objective._parent === 'FindItem' || (objective._parent === 'HandoverItem' && optional)) {
                    verb = 'find';
                }
                obj.item_id = objective._props.target[0];
                obj.item_name = this.locales.en[`${objective._props.target[0]} Name`];
                obj.count = parseInt(objective._props.value);
                if (!targetItem || targetItem._props.QuestItem) {
                    obj.type = `${verb}QuestItem`;
                    //obj.questItem = objective._props.target[0];
                    this.questItems[objective._props.target[0]] = {
                        id: objective._props.target[0]
                    };
                } else {
                    obj.type = `${verb}Item`;
                    obj.item = objective._props.target[0];
                    obj.dogTagLevel = objective._props.dogtagLevel;
                    obj.maxDurability = objective._props.maxDurability;
                    obj.minDurability = objective._props.minDurability;
                    obj.foundInRaid = Boolean(objective._props.onlyFoundInRaid);
                }
            } else if (objective._parent === 'CounterCreator') {
                const counter = objective._props.counter;
                const zoneKeys = [];
                for (const cond of counter.conditions) {
                    if (cond._parent === 'VisitPlace') {
                        //obj.description = en.quest[questId].conditions[objective._props.id];
                    } else if (cond._parent === 'Kills' || cond._parent === 'Shots') {
                        obj.target = this.locales.en[`QuestCondition/Elimination/Kill/Target/${cond._props.target}`] || cond._props.target;
                        obj.count = parseInt(objective._props.value);
                        obj.shotType = 'kill';
                        if (cond._parent === 'Shots') obj.shotType = 'hit';
                        obj.bodyParts = [];
                        if (cond._props.bodyPart) {
                            obj.bodyParts = cond._props.bodyPart;
                        }
                        obj.usingWeapon = [];
                        obj.usingWeaponMods = [];
                        obj.zoneNames = [];
                        obj.distance = null;
                        if (!obj.wearing) obj.wearing = [];
                        if (!obj.notWearing) obj.notWearing = [];
                        if (!obj.healthEffect) obj.healthEffect = null;
                        obj.enemyHealthEffect = null;
                        if (cond._props.distance) {
                            obj.distance = cond._props.distance;
                        }
                        if (cond._props.weapon) {
                            for (const itemId of cond._props.weapon) {
                                if (!this.itemMap[itemId] || this.itemMap[itemId].types.includes('disabled')) {
                                    continue;
                                }
                                obj.usingWeapon.push({
                                    id: itemId,
                                    name: this.locales.en[`${itemId} Name`]
                                });
                            }
                        }
                        if (cond._props.weaponModsInclusive) {
                            for (const modArray of cond._props.weaponModsInclusive) {
                                const modSet = [];
                                for (const itemId of modArray) {
                                    if (!this.locales.en[`${itemId} Name`]) {
                                        this.logger.warn(`Unrecognized weapon mod ${itemId} for objective ${obj.id} of ${questData.name}`);
                                        continue;
                                    }
                                    if (!this.itemMap[itemId] || this.itemMap[itemId].types.includes('disabled')) {
                                        continue;
                                    }
                                    modSet.push({
                                        id: itemId,
                                        name: this.locales.en[`${itemId} Name`]
                                    })
                                }
                                obj.usingWeaponMods.push(modSet);
                            }
                        }
                        if (cond._props.enemyHealthEffects) {
                            obj.enemyHealthEffect = {
                                ...cond._props.enemyHealthEffects[0],
                                time: null
                            };
                        }
                        let targetCode = cond._props.target;
                        if (cond._props.savageRole) {
                            targetCode = cond._props.savageRole[0];
                        }
                        obj.locale = addTranslations(obj.locale, {target: lang => {
                            if (targetCode == 'followerBully') {
                                return `${lang['QuestCondition/Elimination/Kill/BotRole/bossBully']} ${lang['ScavRole/Follower']}`;
                            }
                            if (targetKeyMap[targetCode]) targetCode = targetKeyMap[targetCode];
                            return lang[`QuestCondition/Elimination/Kill/BotRole/${targetCode}`] 
                                || lang[`QuestCondition/Elimination/Kill/Target/${targetCode}`] 
                                || lang[`ScavRole/${targetCode}`] 
                                || targetCode;
                        }}, this.logger);
                    } else if (cond._parent === 'Location') {
                        for (const loc of cond._props.target) {
                            if (loc === 'develop') continue;
                            const map = this.getMapFromNameId(loc);
                            if (map) {
                                obj.locationNames.push(map.name);
                                obj.map_ids.push(map.id);
                            } else {
                                this.logger.warn(`Unrecognized map name ${loc} for objective ${obj.id} of ${questData.name} ${questData.id}`);
                            }
                        }
                    } else if (cond._parent === 'ExitStatus') {
                        obj.exitStatus = cond._props.status;
                        obj.zoneNames = [];
                    } else if (cond._parent === 'ExitName') {
                        obj.locale = addTranslations(obj.locale, {exitName: cond._props.exitName}, this.logger);
                    } else if (cond._parent === 'Equipment') {
                        if (!obj.wearing) obj.wearing = [];
                        if (!obj.notWearing) obj.notWearing = [];
                        if (cond._props.equipmentInclusive) {
                            for (const outfit of cond._props.equipmentInclusive) {
                                const outfitData = [];
                                for (const itemId of outfit) {
                                    outfitData.push({
                                        id: itemId,
                                        name: this.locales.en[`${itemId} Name`]
                                    });
                                }
                                obj.wearing.push(outfitData);
                            }
                        }
                        if (cond._props.equipmentExclusive) {
                            for (const outfit of cond._props.equipmentExclusive) {
                                for (const itemId of outfit) {
                                    obj.notWearing.push({
                                        id: itemId,
                                        name: this.locales.en[`${itemId} Name`]
                                    });
                                }
                            }
                        }
                    } else if (cond._parent === 'InZone') {
                        zoneKeys.push(...cond._props.zoneIds);
                    } else if (cond._parent === 'Shots') {
                        //already handled with Kills
                    } else if (cond._parent === 'HealthEffect') {
                        obj.healthEffect = {
                            bodyParts: cond._props.bodyPartsWithEffects[0].bodyParts,
                            effects: cond._props.bodyPartsWithEffects[0].effects,
                            time: null
                        };
                        if (cond._props.time) obj.healthEffect.time = cond._props.time;
                    } else {
                        this.logger.warn(`Unrecognized counter condition type "${cond._parent}" for objective ${objective._props.id} of ${questData.name}`);
                    }
                }
                if (obj.shotType) {
                    obj.type = 'shoot';
                    obj.playerHealthEffect = obj.healthEffect;
                } else if (obj.exitStatus) {
                    obj.type = 'extract';
                } else if (obj.healthEffect) {
                    obj.type = 'experience';
                } else {
                    obj.type = 'visit';
                }
                if (obj.type === 'shoot' || obj.type === 'extract') {
                    for (const key of zoneKeys) {
                        if (zoneMap[key]) {
                            obj.zoneNames.push(zoneMap[key]);
                        } else {
                            this.logger.warn(`Unrecognized zone ${key} for objective ${objective._props.id} of ${questData.name}`)
                        }
                    }
                }
            } else if (objective._parent === 'PlaceBeacon') {
                obj.type = 'mark';
                obj.item = objective._props.target[0];
                obj.item_id = objective._props.target[0];
                obj.item_name = this.locales.en[`${objective._props.target[0]} Name`];
            } else if (objective._parent === 'LeaveItemAtLocation') {
                obj.count = parseInt(objective._props.value);
                if (this.items[objective._props.target[0]]._props.QuestItem) {
                    obj.type = 'plantQuestItem';
                    obj.item_id = objective._props.target[0];
                    this.questItems[objective._props.target[0]] = {
                        id: objective._props.target[0]
                    };
                } else {
                    obj.type = 'plantItem';
                    obj.item = objective._props.target[0];
                    obj.item_name = this.locales.en[`${objective._props.target[0]} Name`];
                    obj.dogTagLevel = 0;
                    obj.maxDurability = 100;
                    obj.minDurability = 0;
                    obj.foundInRaid = false;
                }
            } else if (objective._parent === 'Skill') {
                obj.type = 'skill';
                obj.skillLevel = {
                    name: this.locales.en[objective._props.target],
                    level: objective._props.value,
                    locale: getTranslations({name: objective._props.target}, this.logger)
                };
            } else if (objective._parent === 'WeaponAssembly') {
                obj.type = 'buildWeapon';
                obj.item = objective._props.target[0];
                obj.item_name = this.locales.en[`${objective._props.target[0]} Name`];
                objective._props.ergonomics.value = parseInt(objective._props.ergonomics.value);
                objective._props.recoil.value = parseInt(objective._props.recoil.value);
                obj.attributes = [
                    {
                        name: 'accuracy',
                        requirement: objective._props.baseAccuracy
                    },
                    {
                        name: 'durability',
                        requirement: objective._props.durability
                    },
                    {
                        name: 'effectiveDistance',
                        requirement: objective._props.effectiveDistance
                    },
                    {
                        name: 'ergonomics',
                        requirement: objective._props.ergonomics
                    },
                    {
                        name: 'height',
                        requirement: objective._props.height
                    },
                    {
                        name: 'magazineCapacity',
                        requirement: objective._props.magazineCapacity
                    },
                    {
                        name: 'muzzleVelocity',
                        requirement: objective._props.muzzleVelocity
                    },
                    {
                        name: 'recoil',
                        requirement: objective._props.recoil
                    },
                    {
                        name: 'weight',
                        requirement: objective._props.weight
                    },
                    {
                        name: 'width',
                        requirement: objective._props.width
                    }
                ];
                for (const att of obj.attributes) {
                    att.requirement.value = parseFloat(att.requirement.value);
                }
                /*obj.accuracy = objective._props.baseAccuracy;
                obj.durability = objective._props.durability;
                obj.effectiveDistance = objective._props.effectiveDistance;
                obj.ergonomics = objective._props.ergonomics;
                obj.height = objective._props.height;
                obj.magazineCapacity = objective._props.magazineCapacity;
                obj.muzzleVelocity = objective._props.muzzleVelocity;
                obj.recoil = objective._props.recoil;
                obj.weight = objective._props.weight;
                obj.width = objective._props.width;
                obj.ergonomics.value = parseInt(obj.ergonomics.value);
                obj.recoil.value = parseInt(obj.recoil.value);*/
                obj.containsAll = [];
                obj.containsOne = [];
                obj.containsCategory = [];
                for (const itemId of objective._props.containsItems) {
                    obj.containsAll.push({
                        id: itemId,
                        name: this.locales.en[`${itemId} Name`]
                    });
                }
                for (const itemId of objective._props.hasItemFromCategory) {
                    if (this.itemMap[itemId] && this.itemMap[itemId].types.includes('disabled')) {
                        continue;
                    }
                    obj.containsCategory.push({
                        id: itemId,
                        name: this.locales.en[`${itemId} Name`]
                    });
                    Object.values(this.itemMap).forEach(item => {
                        if (item.categories.includes(itemId)) {
                            obj.containsOne.push({
                                id: item.id,
                                name: item.name
                            });
                        }
                    });
                }
            } else if (objective._parent === 'TraderLoyalty') {
                obj.type = 'traderLevel';
                obj.trader_id = objective._props.target;
                obj.trader_name = this.locales.en[`${objective._props.target} Nickname`];
                obj.level = objective._props.value;
            } else if (objective._parent === 'VisitPlace') {
                obj.type = 'visit';
            } else if (objective._parent === 'Quest') {
                obj.type = 'taskStatus';
                obj.task = objective._props.target;
                obj.quest_name = this.locales.en[`${objective._props.target} name`];
                obj.status = [];
                for (const statusCode of objective._props.status) {
                    if (!questStatusMap[statusCode]) {
                        this.logger.warn(`Unrecognized quest status "${statusCode}" for quest objective ${this.locales.en[`${req._props.target}`]} ${req._props.target} of ${questData.name}`);
                        continue;
                    }
                    obj.status.push(questStatusMap[statusCode]);
                }
            } else if (objective._parent === 'Level') {
                obj.type = 'playerLevel';
                obj.playerLevel = parseInt(objective._props.value);
            } else {
                this.logger.warn(`Unrecognized type "${objective._parent}" for objective ${objective._props.id} of ${questData.name}`);
                continue;
            }
            if (this.changedQuests[questData.id]?.objectivesChanged && this.changedQuests[questData.id]?.objectivesChanged[obj.id]) {
                for (const key of Object.keys(this.changedQuests[questData.id].objectivesChanged[obj.id])) {
                    obj[key] = this.changedQuests[questData.id].objectivesChanged[obj.id][key];
                }
            }
            this.addMapFromDescription(obj);
            questData.objectives.push(obj);
        }
        if (this.changedQuests[questData.id] && this.changedQuests[questData.id].objectivesAdded) {
            for (const newObj of this.changedQuests[questData.id].objectivesAdded) {
                if (questData.objectives.some(obj => obj.id === newObj.id)) {
                    continue;
                }
                if (!newObj.locale_map) {
                    newObj.locale_map = {};
                }
                newObj.locale_map.description = newObj.id;
                newObj.locale = getTranslations(newObj.locale_map, this.logger);
                questData.objectives.push(newObj);
            }
        }
        if (this.changedQuests[questData.id] && this.changedQuests[questData.id].taskRequirementsAdded) {
            for (const newReq of this.changedQuests[questData.id].taskRequirementsAdded) {
                if (questData.taskRequirements.some(req => req.task === newReq.task)) {
                    continue;
                }
                questData.taskRequirements.push(newReq);
            }
        }
        for (const req of quest.conditions.AvailableForStart) {
            if (req._parent === 'Level') {
                questData.minPlayerLevel = parseInt(req._props.value);
            } else if (req._parent === 'Quest') {
                const questReq = {
                    task: req._props.target,
                    name: this.locales.en[`${req._props.target} name`],
                    status: []
                };
                if (this.changedQuests[questData.id] && this.changedQuests[questData.id].taskRequirementsRemoved) {
                    if (this.changedQuests[questData.id].taskRequirementsRemoved.some(req => req.id === questReq.task)) {
                        continue;
                    }
                }
                for (const statusCode of req._props.status) {
                    if (!questStatusMap[statusCode]) {
                        this.logger.warn(`Unrecognized quest status "${statusCode}" for quest requirement ${this.locales.en[req._props.target]} ${req._props.target} of ${questData.name}`);
                        continue;
                    }
                    questReq.status.push(questStatusMap[statusCode]);
                }
                questData.taskRequirements.push(questReq);
            } else if (req._parent === 'TraderLoyalty' || req._parent === 'TraderStanding') {
                questData.traderLevelRequirements.push({
                    id: req._props.id,
                    trader_id: req._props.target,
                    name: this.locales.en[`${req._props.target} Nickname`],
                    level: parseInt(req._props.value)
                });
            } else {
                this.logger.warn(`Unrecognized quest prerequisite type ${req._parent} for quest requirement ${req._props.id} of ${questData.name}`)
            }
        }
        this.loadRewards(questData, 'finishRewards', quest.rewards.Success);
        this.loadRewards(questData, 'startRewards', quest.rewards.Started);
        if (this.changedQuests[questData.id] && this.changedQuests[questData.id].finishRewardsAdded) {
            for (const rewardType in this.changedQuests[questData.id].finishRewardsAdded) {
                for (const reward of this.changedQuests[questData.id].finishRewardsAdded[rewardType]) {
                    if (reward.locale_map) {
                        reward.locale = getTranslations(reward.locale_map, this.logger);
                    }
                    questData.finishRewards[rewardType].push(reward);
                }
            }
        }
        if (this.changedQuests[questData.id] && this.changedQuests[questData.id].finishRewardsChanged) {
            for (const rewardType in this.changedQuests[questData.id].finishRewardsChanged) {
                questData.finishRewards[rewardType] = this.changedQuests[questData.id].finishRewardsChanged[rewardType];
            }
        }
        let nameMatch = undefined;
        for (const tdQuest of this.tdQuests) {
            if (questData.id == tdQuest.gameId) {
                questData.tarkovDataId = tdQuest.id;
                this.tdMatched.push(tdQuest.id);
                break;
            }
            if (questData.name == tdQuest.title) {
                nameMatch = tdQuest.id;
                //this.logger.warn(`Found possible TarkovData name match for ${questData.name} ${questData.id}`)
            }
        }
        if (typeof nameMatch !== 'undefined') {
            questData.tarkovDataId = nameMatch;
            this.tdMatched.push(nameMatch);
        }
        if (typeof questData.tarkovDataId === 'undefined') {
            questData.tarkovDataId = null;
            //this.logger.warn(`Could not find TarkovData quest id for ${questData.name} ${questData.id}`);
        } else {
            this.mergeTdQuest(questData);
        }
        if (factionMap[questData.id]) questData.factionName = factionMap[questData.id];
        if (this.missingQuests[questData.id]) delete this.missingQuests[questData.id];
    
        if (this.changedQuests[questData.id]?.propertiesChanged) {
            for (const key of Object.keys(this.changedQuests[questData.id].propertiesChanged)) {
                questData[key] = this.changedQuests[questData.id].propertiesChanged[key];
            }
        }
        return questData;
    }
}

const questStatusMap = {
    2: 'active',
    4: 'complete',
    5: 'failed'
};

const targetKeyMap = {
    AnyPmc: 'AnyPMC',
    pmcBot: 'PmcBot',
    marksman: 'Marksman',
    exUsec: 'ExUsec'
};

const zoneMap = {
    huntsman_013: 'Dorms',
    huntsman_020: 'Office',
    eger_barracks_area_1: 'Black Pawn',
    eger_barracks_area_2: 'White Pawn',
    qlight_br_secure_road: 'Highway',
    prapor_27_1: 'Stronghold (Customs)',
    prapor_27_2: 'Medical Camp (Woods)',
    prapor_27_3: 'Pier (Shoreline)',
    prapor_27_4: 'Pier (Shoreline)',
    prapor_hq_area_check_1: 'Command Bunker',
    mechanik_exit_area_1: 'D-2 Extract',
    qlight_pr1_heli2_kill: 'Helicopter at Water Treatment Plant',
    qlight_pc1_ucot_kill: 'Chalets',
    place_merch_022_1: 'Inside ULTRA Mall',
    place_merch_022_2: 'Inside ULTRA Mall',
    place_merch_022_3: 'Inside ULTRA Mall',
    place_merch_022_4: 'Inside ULTRA Mall',
    place_merch_022_5: 'Inside ULTRA Mall',
    place_merch_022_6: 'Inside ULTRA Mall',
    place_merch_022_7: 'Inside ULTRA Mall',
    lijnik_storage_area_1: 'Underground Warehouse',
    quest_zone_kill_c17_adm: 'Pinewood Hotel',
    meh_44_eastLight_kill: 'Lighthouse Island',
    quest_zone_keeper5: 'Woods Mountain',
};

const factionMap = {
    '5e381b0286f77420e3417a74': 'USEC',
    '5e4d4ac186f774264f758336': 'USEC',
    '6179b5eabca27a099552e052': 'USEC',
    '5e383a6386f77465910ce1f3': 'BEAR',
    '5e4d515e86f77438b2195244': 'BEAR',
    '6179b5b06e9dd54ac275e409': 'BEAR'
};

module.exports = UpdateQuestsJob;
