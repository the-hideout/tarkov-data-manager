const fs = require('fs/promises');
const path = require('path');

const got = require('got');
const sharp = require('sharp');
const cheerio = require('cheerio');

const remoteData = require('../modules/remote-data');
const tarkovData = require('../modules/tarkov-data');
const normalizeName = require('../modules/normalize-name');
const DataJob = require('../modules/data-job');
const { getLocalBucketContents, uploadAnyImage } = require('../modules/upload-s3');

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
        [this.rawQuestData, this.items, this.locations, this.mapLoot, this.mapDetails, this.locales, this.itemResults, this.missingQuests, this.changedQuests, this.removedQuests] = await Promise.all([
            tarkovData.quests(true).catch(error => {
                this.logger.error('Error getting quests');
                this.logger.error(error);
                return tarkovData.quests(false);
            }),
            tarkovData.items(),
            tarkovData.locations(),
            tarkovData.mapLoot().then(result => Object.keys(result).reduce((all, mapId) => {
                all[mapId] = result[mapId].spawnpointsForced || [];
                return all;
            }, {})),
            tarkovData.mapDetails(),
            tarkovData.locales(),
            remoteData.get(),
            fs.readFile(path.join(__dirname, '..', 'data', 'missing_quests.json')).then(json => JSON.parse(json)),
            fs.readFile(path.join(__dirname, '..', 'data', 'changed_quests.json')).then(json => JSON.parse(json)),
            fs.readFile(path.join(__dirname, '..', 'data', 'removed_quests.json')).then(json => JSON.parse(json)),
        ]);
        this.maps = await this.jobManager.jobOutput('update-maps', this);
        this.hideout = await this.jobManager.jobOutput('update-hideout', this);
        const traders = await this.jobManager.jobOutput('update-traders', this);
        this.presets = await this.jobManager.jobOutput('update-presets', this, true);
        this.itemMap = await this.jobManager.jobOutput('update-item-cache', this);
        this.s3Images = getLocalBucketContents();
        this.traderIdMap = {};
        for (const trader of traders) {
            this.traderIdMap[trader.tarkovDataId] = trader.id;
        }

        const questItemMap = new Map();
        for (const [id, item] of this.itemResults) {
            if (item.types.includes('quest')) {
                questItemMap.set(id, item);
            }
        }

        this.questItems = {};
        const quests = {
            Task: [],
        };

        for (const questId in this.rawQuestData) {
            if (this.removedQuests[questId]) {
                this.logger.warn(`Skipping removed quest ${this.locales.en[`${questId} name`]} ${questId}`);
                continue;
            }
            quests.Task.push(this.formatRawQuest(this.rawQuestData[questId]));
        }
        
        for (const questId in this.missingQuests) {
            if (questId.startsWith('_')) {
                continue;
            }
            const quest = this.missingQuests[questId];
            if (quests.Task.some(q => q.id === questId)) {
                this.logger.warn(`Missing quest ${this.locales.en[quest.name]} ${quest.id} already exists...`);
                continue;
            }
            try {
                this.logger.warn(`Adding missing quest ${quest.name} ${quest.id}...`);
                quest.name = this.addTranslation(`${questId} name`);
                quest.wikiLink = `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(this.locales.en[`${questId} name`].replaceAll(' ', '_'))}`;
                for (const obj of quest.objectives) {
                    obj.description = this.addTranslation(obj.id);
                    if (obj.type.endsWith('QuestItem')) {
                        this.questItems[obj.item_id] = {
                            id: obj.item_id
                        };
                    }
                    if (obj.type === 'extract') {
                        obj.exitStatus = this.addTranslation(obj.exitStatus.map(stat => `ExpBonus${stat}`));
                    }
                    if (obj.type === 'shoot') {
                        obj.target = this.addTranslation(obj.target);
                    }
                    this.addMapFromDescription(obj);
                }
                for (const tdQuest of this.tdQuests) {
                    if (quest.id == tdQuest.gameId || quest.name === tdQuest.title) {
                        quest.tarkovDataId = tdQuest.id;
                        this.mergeTdQuest(quest, tdQuest);
                        break;
                    }
                }
                quests.Task.push(quest);
            } catch (error) {
                this.logger.error(error);
                this.discordAlert({
                    title: `Error running ${this.name} job`,
                    message: `Error adding missing quest ${quest.name} ${questId}\n${error.stack}`
                });
            }
        }

        for (const changedId in this.changedQuests) {
            if (!this.changedQuests[changedId].objectiveIdsChanged) {
                continue;
            }
            if (Object.keys(this.changedQuests[changedId].objectiveIdsChanged).length > 0) {
                this.logger.warn(`Changed quest ${changedId} has unused objectiveIdsChanged`);
            }
        }

        // filter out invalid task ids
        for (const task of quests.Task) {
            task.taskRequirements = task.taskRequirements.filter(req => quests.Task.some(t => t.id === req.task));
            task.failConditions = task.failConditions.filter(obj => {
                if (obj.type !== 'taskStatus') {
                    return true;
                }
                return quests.Task.some(t => t.id === obj.task);
            });
            task.objectives = task.objectives.filter(obj => {
                if (obj.type !== 'taskStatus') {
                    return true;
                }
                return quests.Task.some(t => t.id === obj.task);
            });
        }

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
            for (const req of quest.traderRequirements) {
                if (req.requirementType !== 'level') {
                    continue;
                }
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

        const filteredPrerequisiteTasks = {};
        for (const quest of quests.Task) {
            /*quest.descriptionMessageId = this.locales.en.quest[quest.id]?.description;
            quest.startMessageId = this.locales.en.quest[quest.id]?.startedMessageText;
            quest.successMessageId = this.locales.en.quest[quest.id]?.successMessageText;
            quest.failMessageId = this.locales.en.quest[quest.id]?.failMessageText;*/
            quest.normalizedName = normalizeName(this.locales.en[quest.name])+(quest.factionName !== 'Any' ? `-${normalizeName(quest.factionName)}` : '');

            const removeReqs = [];
            for (const req of quest.taskRequirements) {
                const questIncluded = quests.Task.some(q => q.id === req.task);
                if (questIncluded) {
                    continue;
                }
                this.logger.warn(`${this.locales.en[quest.name]} (${quest.id}) task requirement ${req.name} (${req.task}) is not a valid task`);
                removeReqs.push(req.task);
            }
            quest.taskRequirements = quest.taskRequirements.filter(req => !removeReqs.includes(req.task));

            quest.minPlayerLevel = getQuestMinLevel(quest.id);

            const trader = traders.find(t => t.name === quest.name);
            const map = this.maps.find(m => m.name === quest.name);
            if (trader || map) {
                quest.wikiLink = `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(quest.name.replaceAll(' ', '_'))}_(quest)`;
            }

            quest.kappaRequired = false;
            quest.lightkeeperRequired = false;

            const earlierTasks = new Set();
            const addEarlier = (id) => {
                earlierTasks.add(id);
                quests.Task.find(q => q.id === id)?.taskRequirements.map(req => req.task).forEach(reqId => {
                    earlierTasks.add(reqId);
                    addEarlier(reqId);
                });
            };
            const requiredIds = quest.taskRequirements.map(req => req.task);
            for (const reqId of requiredIds) {
                quests.Task.find(q => q.id === reqId).taskRequirements.forEach(req => {
                    addEarlier(req.task);
                });
            }
            for (const reqId of requiredIds) {
                if (earlierTasks.has(reqId)) {
                    //const requiredTask = quests.Task.find(q => q.id === reqId);
                    //this.logger.warn(`${this.locales.en[quest.name]} ${quest.id} required task ${this.locales.en[requiredTask.name]} ${requiredTask.id} is a precursor to another required task`);
                    quest.taskRequirements = quest.taskRequirements.filter(req => req.task !== reqId); 
                    if (!(quest.id in filteredPrerequisiteTasks)) {
                        filteredPrerequisiteTasks[quest.id] = 0;
                    }
                    filteredPrerequisiteTasks[quest.id]++;
                }
            }

            // add objective maps from quest items
            for (const obj of quest.objectives) {
                if (obj.type !== 'findQuestItem') {
                    continue;
                }
                const itemInfo = this.getQuestItemLocations(obj.item_id, obj.id);
                if (itemInfo.length > 0) {
                    for (const spawn of itemInfo) {
                        obj.possibleLocations.push(spawn);
                        if (!obj.map_ids.includes(spawn.map)) {
                            obj.map_ids.push(spawn.map);
                        }
                    }
                } else if (questItemLocations[obj.item_id]) {       
                    const mapId = questItemLocations[obj.item_id];
                    if (!obj.map_ids.includes(mapId)) {
                        obj.map_ids.push(mapId);
                    }
                    this.logger.warn(`${quest.name} objective ${obj.id} item ${obj.item_id} has no known coordinates`);
                } else {
                    this.logger.warn(`${quest.name} objective ${obj.id} item ${obj.item_id} has no known spawn`);
                }
            }

            // add objective maps from extracts
            for (const obj of quest.objectives) {
                if (obj.type !== 'extract' || !obj.exitName) {
                    continue;
                }
                let mapId = this.getMapFromExtractName(obj.exitName) || extractMap[obj.exitName];
                if (mapId && !obj.map_ids.includes(mapId)) {
                    obj.map_ids.push(mapId);
                } else if (!mapId) {
                    this.logger.warn(`${quest.name} objective ${obj.id} has no known map for extract ${obj.exitName}`);
                }
            }
    
            // add lighthouse map if turning in items to Lightkeeper
            if (quest.trader === '638f541a29ffd1183d187f57') {
                for (const obj of quest.objectives) {
                    if (obj.type.startsWith('give') && !obj.map_ids.includes('5704e4dad2720bb55b8b4567')) {
                        obj.map_ids.push('5704e4dad2720bb55b8b4567');
                    }
                }
            }
            
            const imageLink = await this.getTaskImageLink(quest, this.rawQuestData[quest.id]?.image);
            if (imageLink) {
                quest.taskImageLink = imageLink;
            } else {
                quest.taskImageLink = `https://${process.env.S3_BUCKET}/unknown-task.webp`;
            }
        }
        if (Object.keys(filteredPrerequisiteTasks).length > 0) {
            this.logger.warn('Filtered out redundant prerequisite tasks:');
            for (const questId in filteredPrerequisiteTasks) {
                const quest = quests.Task.find(q => q.id === questId);
                this.logger.warn(`${this.locales.en[quest.name]} ${questId}: ${filteredPrerequisiteTasks[questId]}`);
            }
        }

        const ignoreMissingQuests = [
            '613708a7f8333a5d15594368',
        ];
        const noQuestData = [];
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
            if (found || ignoreMissingQuests.includes(questId)) continue;
            if (!this.locales.en[`${questId} name`]) {
                continue;
            }
            if (this.removedQuests[questId]) {
                //this.logger.warn(`Quest ${this.locales.en[`${questId} name`]} ${questId} has been removed`);
                continue;
            }
            noQuestData.push(`${this.locales.en[`${questId} name`]} ${questId}`);
        }
        if (noQuestData.length > 0) {
            this.logger.warn(`No quest data found for:`);
            for (const noData of noQuestData) {
                this.logger.warn(noData);
            }
        }

        const neededForKappa = new Set();
        const neededForLightkeeper = new Set();
        const addPreviousRequirements = (neededSet, taskId, hardRequired) => {
            if (hardRequired){
                neededSet.add(taskId);
            }
            const task = quests.Task.find(task => task.id === taskId);
            for (const failOn of task.failConditions) {
                if (failOn.type !== 'taskStatus' || failOn.status[0] !== 'complete') {
                    continue;
                }
                neededSet.add(failOn.task);
            }
            for (const req of task.taskRequirements) {
                //addPreviousRequirements(neededSet, req.task, req.status.length === 1 && req.status[0] === 'complete');
                addPreviousRequirements(neededSet, req.task, true);
            }
        };
        addPreviousRequirements(neededForKappa, '5c51aac186f77432ea65c552', true);
        addPreviousRequirements(neededForLightkeeper, '625d7005a4eb80027c4f2e09', true);
        for (const task of quests.Task) {
            if (neededForKappa.has(task.id)) {
                task.kappaRequired = true;
            }
            if (neededForLightkeeper.has(task.id)) {
                task.lightkeeperRequired = true;
            }

            // sort task requirements by the minimum level required for each
            task.taskRequirements.sort((a, b) => {
                const taskA = quests.Task.find(q => q.id === a.task);
                const taskB = quests.Task.find(q => q.id === b.task);
                return taskA.minPlayerLevel - taskB.minPlayerLevel;
            });

            task.traderLevelRequirements = task.traderRequirements.filter(req => req.requirementType === 'level');
        }

        // sort all tasks so lowest level tasks are first
        quests.Task = quests.Task.sort((taskA,taskB) => {
            let aMinLevel = taskA.minPlayerLevel;
            let bMinLevel = taskB.minPlayerLevel;
            if (!aMinLevel) {
                aMinLevel = 100;
            }
            if (!bMinLevel) {
                bMinLevel = 100;
            }
            if (aMinLevel === bMinLevel) {
                aMinLevel = taskA.taskRequirements.reduce((totalMinLevel, req) => {
                    const reqTask = quests.Task.find(q => q.id === req.task);
                    totalMinLevel += reqTask.minPlayerLevel;
                    return totalMinLevel;
                }, aMinLevel);
                bMinLevel = taskB.taskRequirements.reduce((totalMinLevel, req) => {
                    const reqTask = quests.Task.find(q => q.id === req.task);
                    totalMinLevel += reqTask.minPlayerLevel;
                    return totalMinLevel;
                }, bMinLevel);
            }
            return aMinLevel - bMinLevel;
        });

        for (const id in this.questItems) {
            if (this.items[id]) {
                //all quest items have a yellow background
                //questItems[id].backgroundColor = items[id]._props.BackgroundColor;
                this.questItems[id].width = this.items[id]._props.Width;
                this.questItems[id].height = this.items[id]._props.Height;
                this.questItems[id].name = this.addTranslation(`${id} Name`);
                this.questItems[id].shortName = this.addTranslation(`${id} ShortName`);
                this.questItems[id].description = this.addTranslation(`${id} Description`);
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
            this.questItems[id].normalizedName = normalizeName(this.locales.en[this.questItems[id].name]);
        }

        quests.QuestItem = this.questItems;

        quests.Quest = await this.jobManager.runJob('update-quests-legacy', {data: this.tdQuests, parent: this});

        quests.locale = this.kvData.locale;

        await this.cloudflarePut(quests);
        this.logger.success(`Finished processing ${quests.Task.length} quests`);
        return quests;
    }

    getQuestItemLocations = (questItemId, objectiveId) => {
        const foundItems = [];
        const forceMap = objectiveMap[objectiveId];
        for (const mapId in this.mapLoot) {
            if (forceMap && forceMap !== mapId) {
                continue;
            }
            const spawns = this.mapLoot[mapId].reduce((allSpawns, lootInfo) => {
                if (lootInfo.template.Items.some(lootItem => lootItem._tpl === questItemId)) {
                    allSpawns.push(lootInfo.template.Position);
                }
                return allSpawns;
            }, []);
            if (spawns.length > 0) {
                foundItems.push({map: mapId, positions: spawns});
                continue;
            }
        }
        return foundItems;
    }

    getMapFromExtractName = extractName => {
        for (const mapData of this.maps) {
            for (const exit of this.locations.locations[mapData.id].exits) {
                if (exit.Name === extractName) {
                    return mapData.id;
                }
            }
        }
        return undefined;
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
            const existingItem = rewardData.contains.find(c => c.item === containedItem.item);
            if (existingItem) {
                existingItem.count += containedItem.count;
            } else {
                rewardData.contains.push(containedItem);
            }
        }
        if (!rewardData.contains.length > 0) {
            return rewardData;
        }
        const matchedPreset = Object.values(this.presets).find(preset => {
            if (preset.baseId !== rewardData.item) return false;
            if (preset.containsItems.length !== rewardData.contains.length+1) return false;
            for (const part of preset.containsItems) {
                if (part.item.id === preset.baseId) continue;
                if (!rewardData.contains.some(rewardPart => rewardPart.item === part.item.id)) {
                    return false;
                }
            }
            return true;
        });
        if (matchedPreset) {
            //this.logger.success('Reward matches preset '+matchedPreset.name);
            rewardData.item = matchedPreset.id;
            rewardData.item_name = matchedPreset.name;
            rewardData.base_item_id = matchedPreset.baseId;
            rewardData.contains = [];
            for (const part of matchedPreset.containsItems) {
                rewardData.contains.push({
                    item: part.item.id,
                    name: part.item.name,
                    count: part.count
                });
            }
        } else {
            this.logger.warn('Could not match preset to reward');
            this.logger.log(JSON.stringify(rewardData, null, 4));
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
                    name: this.addTranslation(reward.target, (lang) => {
                        return lang[reward.target] || reward.target;
                    }),
                    level: parseInt(reward.value) / 100,
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
                this.logger.warn(`Unrecognized reward type "${reward.type}" for ${rewardsType} reward ${reward.id} of ${this.locales.en[questData.name]}`);
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
            name: this.addTranslation(`${questId} name`),
            trader: quest.traderId,
            traderName: this.locales.en[`${quest.traderId} Nickname`],
            location_id: locationId,
            locationName: locationName,
            wikiLink: `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(this.locales.en[`${questId} name`].replaceAll(' ', '_'))}`,
            minPlayerLevel: 0,
            taskRequirements: [],
            traderLevelRequirements: [],
            traderRequirements: [],
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
            failConditions: [],
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
            failureOutcome : {
                traderStanding: [],
                items: [],
                offerUnlock: [],
                skillLevelReward: [],
                traderUnlock: [],
                craftUnlock: [],
            },
            restartable: quest.restartable,
            experience: 0,
            tarkovDataId: undefined,
            factionName: 'Any',
            neededKeys: [],
        };
        for (const objective of quest.conditions.AvailableForFinish) {
            const obj = this.formatObjective(questData.id, objective);
            if (!obj) {
                continue;
            }
            questData.objectives.push(obj);
        }
        for (const objective of quest.conditions.Fail) {
            const obj = this.formatObjective(questData.id, objective, true);
            if (obj) {
                questData.failConditions.push(obj);
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
                for (const statusCode of req._props.status) {
                    if (!questStatusMap[statusCode]) {
                        this.logger.warn(`Unrecognized quest status "${statusCode}" for quest requirement ${this.locales.en[req._props.target]} ${req._props.target} of ${questData.name}`);
                        continue;
                    }
                    questReq.status.push(questStatusMap[statusCode]);
                }
                questData.taskRequirements.push(questReq);
            } else if (req._parent === 'TraderLoyalty' || req._parent === 'TraderStanding') {
                const requirementTypes = {
                    TraderLoyalty: 'level',
                    TraderStanding: 'reputation',
                };
                questData.traderRequirements.push({
                    id: req._props.id,
                    trader_id: req._props.target,
                    name: this.locales.en[`${req._props.target} Nickname`],
                    requirementType: requirementTypes[req._parent],
                    compareMethod: req._props.compareMethod,
                    value: parseInt(req._props.value),
                    level: parseInt(req._props.value),
                });
            } else {
                this.logger.warn(`Unrecognized quest prerequisite type ${req._parent} for quest requirement ${req._props.id} of ${questData.name}`)
            }
        }
        this.loadRewards(questData, 'finishRewards', quest.rewards.Success);
        this.loadRewards(questData, 'startRewards', quest.rewards.Started);
        this.loadRewards(questData, 'failureOutcome', quest.rewards.Fail);
        let nameMatch = undefined;
        for (const tdQuest of this.tdQuests) {
            if (questData.id == tdQuest.gameId) {
                questData.tarkovDataId = tdQuest.id;
                break;
            }
            if (questData.name == tdQuest.title) {
                nameMatch = tdQuest.id;
                //this.logger.warn(`Found possible TarkovData name match for ${questData.name} ${questData.id}`)
            }
        }
        if (typeof nameMatch !== 'undefined') {
            questData.tarkovDataId = nameMatch;
        }
        if (typeof questData.tarkovDataId === 'undefined') {
            questData.tarkovDataId = null;
            //this.logger.warn(`Could not find TarkovData quest id for ${questData.name} ${questData.id}`);
        } else {
            this.mergeTdQuest(questData);
        }
        if (factionMap[questData.id]) questData.factionName = factionMap[questData.id];
        if (this.missingQuests[questData.id]) delete this.missingQuests[questData.id];
    
        if (this.changedQuests[questData.id]) {
            if (this.changedQuests[questData.id].propertiesChanged) {
                for (const key of Object.keys(this.changedQuests[questData.id].propertiesChanged)) {
                    /*if (key === 'taskRequirements' && questData.taskRequirements.length > 0) {
                        this.logger.warn(`Overwriting existing task requirements with:`);
                        this.logger.warn(JSON.stringify(this.changedQuests[questData.id].propertiesChanged[key], null, 4));
                    } else if (key === 'taskRequirements' && questData.taskRequirements.length === 0) {
                        this.logger.warn(`Adding missing task requirements`);
                        this.logger.warn(JSON.stringify(this.changedQuests[questData.id].propertiesChanged[key], null, 4));
                    } else {
                        this.logger.warn(`Changing ${key} property to: ${JSON.stringify(this.changedQuests[questData.id].propertiesChanged[key], null, 4)}`);
                    }*/
                    questData[key] = this.changedQuests[questData.id].propertiesChanged[key];
                }
            }
            if (this.changedQuests[questData.id].taskRequirementsAdded) {
                let skippedAdditions = [];
                for (const newReq of this.changedQuests[questData.id].taskRequirementsAdded) {
                    if (questData.taskRequirements.some(req => req.task === newReq.task)) {
                        skippedAdditions.push(newReq)
                        continue;
                    }
                    questData.taskRequirements.push(newReq);
                }
                if (skippedAdditions.length > 0) {
                    this.logger.warn('Manually added task requirements already present');
                    for(const req of skippedAdditions) {
                        console.log(req);
                    }
                }
            }
            if (this.changedQuests[questData.id].taskRequirementsRemoved) {
                const reqsCount = questData.taskRequirements.length;
                questData.taskRequirements = questData.taskRequirements.filter(questReq => {
                    const reqRemoved = this.changedQuests[questData.id].taskRequirementsRemoved.find(req => req.id === questReq.task);
                    /*if (reqRemoved) {
                        this.logger.warn('Removing quest requirement');
                        this.logger.warn(JSON.stringify(questReq, null, 4));
                    }*/
                    return !reqRemoved;
                });
                if (questData.taskRequirements.length === reqsCount) {
                    this.logger.warn('No matching quest requirements to remove');
                    this.logger.warn(JSON.stringify(this.changedQuests[questData.id].taskRequirementsRemoved, null, 4));
                }
            }
            if (this.changedQuests[questData.id].objectivesChanged) {
                for (const objId in this.changedQuests[questData.id].objectivesChanged) {
                    const obj = questData.objectives.find(o => o.id === objId);
                    if (!obj) {
                        this.logger.warn(`Objective ${objId} not found in quest data`);
                        continue;
                    }
                    for (const key of Object.keys(this.changedQuests[questData.id].objectivesChanged[obj.id])) {
                        //this.logger.warn(`Changing objective ${objId} ${key} to ${JSON.stringify(this.changedQuests[questData.id].objectivesChanged[obj.id], null, 4)}`);
                        obj[key] = this.changedQuests[questData.id].objectivesChanged[obj.id][key];
                    }
                }
            }
            if (this.changedQuests[questData.id].objectivesAdded) {
                let addedCount = 0;
                for (const newObj of this.changedQuests[questData.id].objectivesAdded) {
                    if (questData.objectives.some(obj => obj.id === newObj.id)) {
                        continue;
                    }
                    if (!newObj.locale_map) {
                        newObj.locale_map = {};
                    }
                    newObj.locale_map.description = newObj.id;
                    questData.objectives.push(newObj);
                    addedCount++;
                }
                if (addedCount === 0) {
                    this.logger.warn('Manually added objectives already present');
                }
            }
            if (this.changedQuests[questData.id].objectivePropertiesChanged) {
                for (const objId in this.changedQuests[questData.id].objectivePropertiesChanged) {
                    const obj = questData.objectives.find(o => o.id === objId);
                    if (!obj) {
                        continue;
                    }
                    const changes = this.changedQuests[questData.id].objectivePropertiesChanged[objId];
                    for (const propName in changes) {
                        obj[propName] = changes[propName];
                    }
                }
            }
            if (this.changedQuests[questData.id].finishRewardsAdded) {
                //this.logger.warn('Adding finish rewards');
                //this.logger.warn(JSON.stringify(this.changedQuests[questData.id].finishRewardsAdded), null, 4);
                for (const rewardType in this.changedQuests[questData.id].finishRewardsAdded) {
                    for (const reward of this.changedQuests[questData.id].finishRewardsAdded[rewardType]) {
                        questData.finishRewards[rewardType].push(reward);
                    }
                }
            }
            if (this.changedQuests[questData.id].finishRewardsChanged) {
                //this.logger.warn('Changing finish rewards');
                //this.logger.warn(JSON.stringify(this.changedQuests[questData.id].finishRewardsChanged), null, 4);
                for (const rewardType in this.changedQuests[questData.id].finishRewardsChanged) {
                    questData.finishRewards[rewardType] = this.changedQuests[questData.id].finishRewardsChanged[rewardType];
                    if (rewardType === 'skillLevelReward') {
                        for (const reward of questData.finishRewards[rewardType]) {
                            reward.name = this.addTranslation(reward.name);
                        }
                    }
                }
            }
            if (this.changedQuests[questData.id].startRewardsChanged) {
                //this.logger.warn('Changing start rewards');
                //this.logger.warn(JSON.stringify(this.changedQuests[questData.id].startRewardsChanged), null, 4);
                for (const rewardType in this.changedQuests[questData.id].startRewardsChanged) {
                    questData.startRewards[rewardType] = this.changedQuests[questData.id].startRewardsChanged[rewardType];
                    if (rewardType === 'skillLevelReward') {
                        for (const reward of questData.startRewards[rewardType]) {
                            reward.name = this.addTranslation(reward.name);
                        }
                    }
                }
            }
            if (this.changedQuests[questData.id].translationKeys) {
                for (const key of this.changedQuests[questData.id].translationKeys) {
                    this.addTranslation(key);
                }
            }
        }
        const locationTypes = [
            'visit',
            'findQuestItem',
            'plantItem',
            'mark',
            'shoot',
        ];
        for (const obj of questData.objectives) {
            if (obj.zoneKeys) {
                /*obj.zoneKeys.forEach(zoneKey => {
                    if (!zoneMap[zoneKey]) {
                        if (!questData.location_id) {
                            this.logger.warn(`Zone key ${zoneKey} is not associated with a map`);
                        }
                        return;
                    }
                    let mapIds = zoneMap[zoneKey];
                    if (!Array.isArray(mapIds)) {
                        mapIds = [mapIds];
                    }
                    for (const mapId of mapIds) {
                        if (!obj.map_ids.includes(mapId)) {
                            obj.map_ids.push(mapId);
                        } 
                    }
                });*/
                obj.zones = obj.zoneKeys.reduce((zones, zoneId) => {
                    for (const mapId in this.mapDetails) {
                        for (const trigger of this.mapDetails[mapId].zones) {
                            if (trigger.id === zoneId) {
                                zones.push({
                                    id: trigger.id,
                                    map: mapId,
                                    ...trigger.location,
                                });        
                                if (!obj.map_ids.includes(mapId)) {
                                    obj.map_ids.push(mapId);
                                } 
                            }
                        }
                    }
                    if (zones.length === 0) {
                        this.logger.warn(`Zone key ${zoneId} is not associated with a map`);
                    }
                    return zones;
                }, []);
            } else {
                obj.zones = [];
            }
            if (obj.map_ids.length === 0 && locationTypes.includes(obj.type)) {
                if (obj.map_ids.length === 0 && questData.location_id) {
                    obj.locationNames.push(questData.locationName);
                    obj.map_ids.push(questData.location_id);
                }
            }
        }
        return questData;
    }

    formatObjective(questId, objective, failConditions = false) {
        if (this.changedQuests[questId]?.objectivesRemoved?.includes(objective._props.id)) {
            return false;
        }
        let objectiveId = objective._props.id;
        for (const questId in this.changedQuests) {
            if (!this.changedQuests[questId].objectiveIdsChanged) {
                continue;
            }
            if (!this.changedQuests[questId].objectiveIdsChanged[objectiveId]) {
                continue;
            }
            logger.warn(`Changing objective id ${objectiveId} to ${this.changedQuests[questId].objectiveIdsChanged[objectiveId]}`);
            objectiveId = this.changedQuests[questId]?.objectiveIdsChanged[objectiveId];
            delete this.changedQuests[questId].objectiveIdsChanged[objectiveId];
        }
        let optional = false;
        if (objective._props.parentId) {
            optional = true;
        }
        const obj = {
            id: objectiveId,
            description: (!failConditions || this.locales.en[objectiveId]) ? this.addTranslation(objectiveId) : this.addTranslation(objectiveId, 'en', ''),
            type: null,
            count: isNaN(objective._props.value) ? null : parseInt(objective._props.value),
            optional: optional,
            locationNames: [],
            map_ids: [],
            zoneKeys: [],
            zoneNames: [],
        };
        if (objective._parent === 'FindItem' || objective._parent === 'HandoverItem') {
            const targetItem = this.items[objective._props.target[0]];
            let verb = 'give';
            if (objective._parent === 'FindItem' || (objective._parent === 'HandoverItem' && optional)) {
                verb = 'find';
            }
            obj.item_id = objective._props.target[0];
            obj.item_name = this.locales.en[`${objective._props.target[0]} Name`];
            //obj.count = parseInt(objective._props.value);
            if (!targetItem || targetItem._props.QuestItem) {
                obj.type = `${verb}QuestItem`;
                //obj.questItem = objective._props.target[0];
                this.questItems[objective._props.target[0]] = {
                    id: objective._props.target[0]
                };
                obj.possibleLocations = [];
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
            for (const cond of counter.conditions) {
                if (cond._parent === 'VisitPlace') {
                    //obj.description = en.quest[questId].conditions[objective._props.id];
                    obj.zoneKeys.push(cond._props.target);
                } else if (cond._parent === 'Kills' || cond._parent === 'Shots') {
                    obj.target = this.locales.en[`QuestCondition/Elimination/Kill/Target/${cond._props.target}`] || cond._props.target;
                    //obj.count = parseInt(objective._props.value);
                    obj.shotType = 'kill';
                    if (cond._parent === 'Shots') obj.shotType = 'hit';
                    //obj.bodyParts = [];
                    if (cond._props.bodyPart) {
                        obj.bodyParts = this.addTranslation(cond._props.bodyPart.map(part => `QuestCondition/Elimination/Kill/BodyPart/${part}`));
                    }
                    obj.usingWeapon = [];
                    obj.usingWeaponMods = [];
                    obj.distance = null;
                    obj.timeFromHour = null;
                    obj.timeUntilHour = null;
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
                                //this.logger.warn(`Unrecognized weapon ${itemId} for objective ${obj.id} of ${questData.name}`);
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
                                    this.logger.warn(`Unrecognized weapon mod ${itemId} for objective ${obj.id}`);
                                    continue;
                                }
                                if (!this.itemMap[itemId] || this.itemMap[itemId].types.includes('disabled')) {
                                    this.logger.warn(`Disabled weapon mod ${itemId} for objective ${obj.id}`);
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
                            time: null,
                        };
                        if (cond._props.enemyHealthEffects[0].bodyParts) {
                            obj.bodyParts = this.addTranslation(cond._props.enemyHealthEffects[0].bodyParts.map(part => `QuestCondition/Elimination/Kill/BodyPart/${part}`));
                            obj.enemyHealthEffect.bodyParts = obj.bodyParts;
                        }
                        if (cond._props.enemyHealthEffects[0].effects) {
                            obj.effects = this.addTranslation(cond._props.enemyHealthEffects[0].effects.map(eff => {
                                if (eff === 'Stimulator') {
                                    return '5448f3a64bdc2d60728b456a Name';
                                }
                                return eff;
                            }));
                            obj.enemyHealthEffect.effects = obj.effects;
                        }
                    }
                    let targetCode = cond._props.target;
                    obj.targetNames = [this.addTranslation(targetCode, (lang, langCode) => {
                        return this.getMobName(this.getMobKey(targetCode), lang, langCode);
                    })];
                    if (cond._props.savageRole) {
                        const ignoreRoles = [
                            'assault',
                            'cursedAssault',
                        ];
                        const allowedRoles = cond._props.savageRole.filter(role => !ignoreRoles.includes(role)).reduce((roles, role) => {
                            const key = this.getMobKey(role);
                            if (!roles.includes(key)) {
                                roles.push(key);
                            }
                            return roles;
                        }, []);
                        if (allowedRoles.length < 1) {
                            allowedRoles.push('savage');
                        }
                        targetCode = allowedRoles[0];
                        obj.targetNames = allowedRoles.map(key => {
                            return this.addTranslation(key, (lang, langCode) => {
                                return this.getMobName(key, lang, langCode);
                            });
                        });
                    }
                    obj.target = obj.targetNames[0];
                    if (cond._props.daytime) {
                        obj.timeFromHour = cond._props.daytime.from;
                        obj.timeUntilHour = cond._props.daytime.to;
                    }
                } else if (cond._parent === 'Location') {
                    for (const loc of cond._props.target) {
                        if (loc === 'develop') continue;
                        const map = this.getMapFromNameId(loc);
                        if (map) {
                            obj.locationNames.push(map.name);
                            obj.map_ids.push(map.id);
                        } else {
                            this.logger.warn(`Unrecognized map name ${loc} for objective ${obj.id}`);
                        }
                    }
                } else if (cond._parent === 'ExitStatus') {
                    obj.exitStatus = this.addTranslation(cond._props.status.map(stat => `ExpBonus${stat}`));
                } else if (cond._parent === 'ExitName') {
                    obj.exitName = this.addTranslation(cond._props.exitName)
                    if (cond._props.exitName && obj.map_ids.length === 0) {
                        const mapIdWithExtract = Object.keys(this.mapDetails).find(mapId => {
                            const extracts = this.mapDetails[mapId].extracts;
                            return extracts.some(e => e.settings.Name === cond._props.exitName);
                        });
                        if (mapIdWithExtract) {
                            obj.map_ids.push(mapIdWithExtract);
                        } else {
                            this.logger.warn(`No map found for extract ${cond._props.exitName}`);
                        }
                    }
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
                    obj.zoneKeys.push(...cond._props.zoneIds);
                } else if (cond._parent === 'Shots') {
                    //already handled with Kills
                } else if (cond._parent === 'HealthEffect') {
                    obj.healthEffect = {
                        bodyParts: cond._props.bodyPartsWithEffects[0].bodyParts,
                        effects: cond._props.bodyPartsWithEffects[0].effects,
                        time: null,
                    };
                    if (cond._props.bodyPartsWithEffects[0].bodyParts) {
                        obj.bodyParts = this.addTranslation(cond._props.bodyPartsWithEffects[0].bodyParts.map(part => `QuestCondition/Elimination/Kill/BodyPart/${part}`));
                        obj.healthEffect.bodyParts = obj.bodyParts;
                    }
                    if (cond._props.bodyPartsWithEffects[0].effects) {
                        obj.effects = this.addTranslation(cond._props.bodyPartsWithEffects[0].effects.map(eff => {
                            if (eff === 'Stimulator') {
                                return '5448f3a64bdc2d60728b456a Name';
                            }
                            return eff;
                        }));
                        obj.healthEffect.effects = obj.effects;
                    }
                    if (cond._props.time) obj.healthEffect.time = cond._props.time;
                } else if (cond._parent === 'UseItem') {
                    obj.useAny = cond._props.target.filter(id => this.itemMap[id]).reduce((allItems, current) => {
                        if (!allItems.includes(current)) {
                            allItems.push(current);
                        }
                        return allItems;
                    }, []);
                    obj.compareMethod = cond._props.compareMethod;
                    obj.count = cond._props.value;
                } else if (cond._parent === 'LaunchFlare') {
                    obj.useAny = [
                        '624c0b3340357b5f566e8766',
                        '62389be94d5d474bf712e709',
                    ];
                    obj.count = 1;
                    obj.compareMethod = '>=';
                    obj.zoneKeys.push(cond._props.target);
                } else {
                    this.logger.warn(`Unrecognized counter condition type "${cond._parent}" for objective ${objective._props.id}`);
                }
            }
            if (obj.shotType) {
                obj.type = 'shoot';
                obj.playerHealthEffect = obj.healthEffect;
            } else if (obj.exitStatus) {
                obj.type = 'extract';
            } else if (obj.healthEffect) {
                obj.type = 'experience';
            } else if (obj.useAny) {
                obj.type = 'useItem';
            } else {
                obj.type = 'visit';
            }
        } else if (objective._parent === 'PlaceBeacon') {
            obj.type = 'mark';
            obj.item = objective._props.target[0];
            obj.item_id = objective._props.target[0];
            obj.item_name = this.locales.en[`${objective._props.target[0]} Name`];
            obj.zoneKeys = [objective._props.zoneId];
        } else if (objective._parent === 'LeaveItemAtLocation') {
            obj.count = parseInt(objective._props.value);
            obj.zoneKeys = [objective._props.zoneId];
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
                name: this.addTranslation(objective._props.target),
                level: objective._props.value,
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
        } else if (objective._parent === 'TraderStanding') {
            obj.type = 'traderStanding';
            obj.trader_id = objective._props.target;
            obj.trader_name = this.locales.en[`${objective._props.target} Nickname`];
            obj.compareMethod = objective._props.compareMethod;
            obj.value = objective._props.value;
        } else if (objective._parent === 'VisitPlace') {
            obj.type = 'visit';
        } else if (objective._parent === 'Quest') {
            obj.type = 'taskStatus';
            obj.task = objective._props.target;
            obj.quest_name = this.locales.en[`${objective._props.target} name`];
            obj.status = [];
            for (const statusCode of objective._props.status) {
                if (!questStatusMap[statusCode]) {
                    this.logger.warn(`Unrecognized quest status "${statusCode}" for quest objective ${this.locales.en[`${req._props.target}`]} ${req._props.target}`);
                    continue;
                }
                obj.status.push(questStatusMap[statusCode]);
            }
        } else if (objective._parent === 'Level') {
            obj.type = 'playerLevel';
            obj.playerLevel = parseInt(objective._props.value);
        } else {
            this.logger.warn(`Unrecognized type "${objective._parent}" for objective ${objective._props.id}`);
            return;
        }
        if (obj.zoneKeys.length > 0) {
            const reducedZones = obj.zoneKeys.reduce((reducedKeys, key) => {
                if (!this.locales.en[key]) {
                    if (obj.type === 'shoot' || obj.type === 'extract' || obj.type === 'useItem') {
                        this.logger.warn(`No translation for zone ${key} for objective ${objective._props.id}`);
                    }
                    return reducedKeys;
                }
                if (!reducedKeys.some(savedKey => this.locales.en[savedKey] === this.locales.en[key])) {
                    reducedKeys.push(key);
                }
                return reducedKeys;
            }, []);
            obj.zoneNames = this.addTranslation(reducedZones);
        } else {
            delete obj.zoneKeys;
        }
        this.addMapFromDescription(obj);
        return obj;
    }

    async getTaskImageLink(task, imagePath) {
        if (Boolean(process.env.TEST_JOB)) {
            return null;
        }
        const s3FileName = `${task.id}.webp`;
        const s3ImageLink = `https://${process.env.S3_BUCKET}/${s3FileName}`;
        if (this.s3Images.includes(s3FileName)) {
            return s3ImageLink;
        }
        if (imagePath) {
            const imageId = imagePath.replace('/files/quest/icon/', '').split('.')[0];
            const extensions = ['.png', '.jpg'];
            for (const ext of extensions) {
                try {
                    const response = await fetch(`https://dev.sp-tarkov.com/SPT-AKI/Server/raw/branch/master/project/assets/images/quests/${imageId}${ext}`);
                    if (!response.ok) {
                        continue;
                    }
                    const image = sharp(await response.arrayBuffer()).webp({lossless: true});
                    const metadata = await image.metadata();
                    if (metadata.width <= 1 || metadata.height <= 1) {
                        continue;
                    }
                    await uploadAnyImage(image, s3FileName, 'image/webp');
                    this.logger.log(`Retrieved ${this.locales.en[`${task.id} name`]} ${task.id} image from SPT`);
                    return s3ImageLink;
                } catch (error) {
                    this.logger.error(`Error fetching ${imageId}.${ext} from SPT: ${error.stack}`);
                }
            }
        }
        if (!task.wikiLink) {
            return null;
        }
        const pageResponse = await fetch(task.wikiLink);//.then(response => cheerio.load(response.body));
        if (!pageResponse.ok) {
            return null;
        }
        const $ = cheerio.load(await pageResponse.text());
        const imageUrl = $('.va-infobox-mainimage-image img').first().attr('src');
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            return null;
        }
        const image = sharp(await imageResponse.arrayBuffer()).webp({lossless: true});
        const metadata = await image.metadata();
        if (metadata.width <= 1 || metadata.height <= 1) {
            return null;
        }
        await uploadAnyImage(image, s3FileName, 'image/webp');
        this.logger.log(`Retrieved ${this.locales.en[`${task.id} name`]} ${task.id} image from wiki`);
        return s3ImageLink;
    }
}

const questItemLocations = {};

const extractMap = {};

const objectiveMap = {
    '5a2819c886f77460ba564f38': '5704e554d2720bac5b8b456e',
    '5979fc2686f77426d702a0f2': '56f40101d2720b2a4d8b45d6',
};

const questStatusMap = {
    2: 'active',
    4: 'complete',
    5: 'failed'
};

const factionMap = {
    '5e381b0286f77420e3417a74': 'USEC',
    '5e4d4ac186f774264f758336': 'USEC',
    '6179b5eabca27a099552e052': 'USEC',
    '639282134ed9512be67647ed': 'USEC',
    '5e383a6386f77465910ce1f3': 'BEAR',
    '5e4d515e86f77438b2195244': 'BEAR',
    '6179b5b06e9dd54ac275e409': 'BEAR',
    '639136d68ba6894d155e77cf': 'BEAR',
};

module.exports = UpdateQuestsJob;
