import fs from 'node:fs/promises';
import path from 'node:path';

import got from 'got';

import DataJob from '../modules/data-job.mjs';
import remoteData from '../modules/remote-data.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import { getLocalBucketContents } from '../modules/upload-s3.mjs';
import presetData from '../modules/preset-data.mjs';
import webSocketServer from '../modules/websocket-server.mjs';
import { createAndUploadFromSource } from '../modules/image-create.mjs';

class UpdateQuestsJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-quests', loadLocales: true});
        this.kvName = 'quest_data';
    }

    async run() {
        this.logger.log('Processing quests...');
        [
            this.tdQuests,
            this.rawQuestData,
            this.achievements,
            this.achievementStats,
            this.items,
            this.locations,
            this.mapLoot,
            this.mapDetails,
            this.locales,
            this.itemResults,
            this.missingQuests,
            this.changedQuests,
            this.removedQuests,
            this.neededKeys,
            this.questDelays,
            this.questConfig,
            this.s3Images,
        ] = await Promise.all([
            got('https://tarkovtracker.github.io/tarkovdata/quests.json', {
                responseType: 'json',
                resolveBodyOnly: true,
            }),
            tarkovData.quests(true).catch(error => {
                this.logger.error('Error getting quests');
                this.logger.error(error);
                return tarkovData.quests(false);
            }),
            tarkovData.achievements(),
            tarkovData.achievementStats(),
            tarkovData.items(),
            tarkovData.locations(),
            tarkovData.mapLoot().then(result => Object.keys(result).reduce((all, mapId) => {
                all[mapId] = result[mapId].spawnpointsForced || [];
                return all;
            }, {})),
            tarkovData.mapDetails(),
            tarkovData.locales(),
            remoteData.get(),
            fs.readFile(path.join(import.meta.dirname, '..', 'data', 'missing_quests.json')).then(json => JSON.parse(json)),
            fs.readFile(path.join(import.meta.dirname, '..', 'data', 'changed_quests.json')).then(json => JSON.parse(json)),
            fs.readFile(path.join(import.meta.dirname, '..', 'data', 'removed_quests.json')).then(json => JSON.parse(json)),
            fs.readFile(path.join(import.meta.dirname, '..', 'data', 'needed_keys.json')).then(json => JSON.parse(json)),
            fs.readFile(path.join(import.meta.dirname, '..', 'data', 'quest_delays.json')).then(json => JSON.parse(json)),
            tarkovData.questConfig(),
            getLocalBucketContents(),
        ]);
        this.maps = await this.jobManager.jobOutput('update-maps', this);
        this.hideout = await this.jobManager.jobOutput('update-hideout', this);
        this.traders = (await this.jobManager.jobOutput('update-traders', this));
        this.presets = presetData.presets.presets;
        this.itemMap = await this.jobManager.jobOutput('update-item-cache', this);

        // only keep details for active maps
        this.mapDetails = Object.keys(this.mapDetails).reduce((valid, mapId) => {
            if (this.maps.some(m => m.id === mapId)) {
                valid[mapId] = this.mapDetails[mapId];
            }
            return valid;
        }, {});

        // only keep loot for active maps
        this.mapLoot = Object.keys(this.mapLoot).reduce((valid, mapId) => {
            if (this.maps.some(m => m.id === mapId)) {
                valid[mapId] = this.mapLoot[mapId];
            }
            return valid;
        }, {});

        const questItemMap = new Map();
        for (const [id, item] of this.itemResults) {
            if (item.types?.includes('quest')) {
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
            const eventQuestConfig = this.questConfig.eventQuests[questId];
            if (eventQuestConfig?.endTimestamp) {
                this.logger.warn(`Skipping event quest ${this.locales.en[`${questId} name`]} ${questId}`);
                continue;
            }
            if (!this.locales.en[`${questId} name`]) {
                this.logger.warn(`Skipping quest ${this.rawQuestData[questId].QuestName} ${questId} - localization not found`);
                continue;
            }
            if (skipQuests.includes(questId)) {
                this.logger.warn(`Skipping quest ${this.rawQuestData[questId].QuestName} ${questId} - manual skip`);
                continue;
            }
            quests.Task.push(await this.formatRawQuest(this.rawQuestData[questId]));
        }
        
        for (const questId in this.missingQuests) {
            if (questId.startsWith('_')) {
                continue;
            }
            const quest = this.missingQuests[questId];
            if (quests.Task.some(q => q.id === questId)) {
                this.logger.warn(`Missing quest ${quest.name} ${questId} already exists...`);
                continue;
            }
            try {
                this.logger.warn(`Adding missing quest ${quest.name} ${quest.id}...`);
                quest.name = this.addTranslation(`${questId} name`);
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
                        obj.target = this.addMobTranslation(obj.target);
                        obj.targetNames = [this.addMobTranslation(obj.target)];
                        if (obj.usingWeaponTypes) {
                            obj.usingWeapon = obj.usingWeaponTypes.reduce((weapons, categoryId) => {
                                Object.values(this.itemMap).forEach(item => {
                                    if (!item.categories.includes(categoryId)) {
                                        return;
                                    }
                                    if (item.types.includes('preset')) {
                                        return;
                                    }
                                    weapons.push({
                                        id: item.id,
                                        name: this.locales.en[item.name],
                                    });
                                });
                                return weapons;
                            }, []);
                        }
                    }
                    if (obj.item && !obj.items) {
                        obj.items = [obj.item];
                    }
                    this.addMapFromDescription(obj);
                }
                quests.Task.push(quest);
            } catch (error) {
                this.logger.error(error);
                this.addJobSummary(`${quest.name} ${questId}\n${error.stack}`, 'Error Adding Missing Quest');
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

            // get old tarkovdata quest ids
            for (const tdQuest of this.tdQuests) {
                if (task.id == tdQuest.gameId || this.getTranslation(task.name) === tdQuest.title) {
                    task.tarkovDataId = tdQuest.id;
                    break;
                }
            }
        }
        
        // validate task requirements

        const getMinPlayerLevelForTraderLevel = (traderId, traderLevel) => {
            const trader = this.traders.find(tr => tr.id === traderId);
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
        const missingImages = [];
        for (const quest of quests.Task) {
            quest.normalizedName = this.normalizeName(this.locales.en[quest.name])+(quest.factionName !== 'Any' ? `-${this.normalizeName(quest.factionName)}` : '');

            if (this.questDelays[quest.id]) {
                quest.availableDelaySecondsMin = this.questDelays[quest.id].min;
                quest.availableDelaySecondsMax = this.questDelays[quest.id].max;
            }

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

            const trader = this.traders.find(t => t.normalizedName === quest.normalizedName);
            const map = this.maps.find(m => m.normalizedName === quest.normalizedName);
            let wikiLinkSuffix = '';
            if (trader || map) {
                wikiLinkSuffix = '_(quest)';
            }
            quest.wikiLink = `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(this.getTranslation(quest.name).replaceAll(' ', '_'))}${wikiLinkSuffix}`;

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

            // add locations for zones and quest items
            for (const obj of quest.objectives) {
                obj.zones = [];
                obj.zoneKeys?.forEach((zoneId) => {
                    for (const mapId in this.mapDetails) {
                        for (const trigger of this.mapDetails[mapId].zones) {
                            if (trigger.id === zoneId) {
                                obj.zones.push({
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
                    if (obj.zones.length === 0) {
                        this.logger.warn(`Zone key ${zoneId} is not associated with a map`);
                    }
                });
                // add objective map from zone
                if (obj.map_ids.length === 0 && obj.zones?.length) {
                    obj.map_ids = obj.zones.reduce((maps, zone) => {
                        if (!maps.includes(zone.map)) {
                            maps.push(zone.map);
                        }
                        return maps;
                    }, []);
                }
                // add objective map from targets
                if (obj.map_ids.length === 0 && obj.targetLocations?.length) {
                    obj.map_ids = obj.targetLocations;
                }
                delete obj.targetLocations;
                
                if (obj.type !== 'findQuestItem') {
                    continue;
                }

                // add objective map from quest item
                const itemInfo = this.getQuestItemLocations(obj.item_id, obj.id);
                if (itemInfo.length > 0) {
                    if (!obj.possibleLocations) {
                        obj.possibleLocations = [];
                    }
                    for (const spawn of itemInfo) {
                        obj.possibleLocations.push(spawn);
                        if (!obj.map_ids.includes(spawn.map)) {
                            obj.map_ids.push(spawn.map);
                        }
                    }
                } else if (questItemLocations[obj.item_id]) {    
                    // quest item location is manually set   
                    const mapId = questItemLocations[obj.item_id];
                    if (!obj.map_ids.includes(mapId)) {
                        obj.map_ids.push(mapId);
                    }
                    this.logger.warn(`${this.getTranslation(quest.name)} ${quest.id} objective ${obj.id} item ${obj.item_name} ${obj.item_id} has no known coordinates`);
                } else {
                    this.logger.warn(`${this.getTranslation(quest.name)} ${quest.id} objective ${obj.id} item ${obj.item_name} ${obj.item_id} has no known spawn`);
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
            this.addNeededKeys(quest);
            
            const imageLink = await this.getTaskImageLink(quest);
            if (imageLink) {
                quest.taskImageLink = imageLink;
            } else {
                quest.taskImageLink = `https://${process.env.S3_BUCKET}/unknown-task.webp`;
                missingImages.push(quest.id);
            }

            for (const obj of quest.objectives) {
                if (!obj.locale_map) {
                    continue;
                }
                for (const key of Object.values(obj.locale_map)) {
                    this.addTranslation(key);
                }
                delete obj.locale_map;
            }
        }
        if (Object.keys(filteredPrerequisiteTasks).length > 0) {
            this.logger.warn('Filtered out redundant prerequisite tasks:');
            for (const questId in filteredPrerequisiteTasks) {
                const quest = quests.Task.find(q => q.id === questId);
                this.logger.log(`${this.locales.en[quest.name]} ${questId}: ${filteredPrerequisiteTasks[questId]}`);
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
            if (this.achievements.some(a => a.id === questId)) {
                continue;
            }
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
            if (this.removedQuests[questId] || skipQuests.includes(questId)) {
                //this.logger.warn(`Quest ${this.locales.en[`${questId} name`]} ${questId} has been removed`);
                continue;
            }
            noQuestData.push(`${this.locales.en[`${questId} name`]} ${questId}`);
        }
        if (noQuestData.length > 0) {
            this.logger.warn(`No quest data found for:`);
            for (const noData of noQuestData) {
                this.logger.log(noData);
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
                if (!itemData.image_8x_link && webSocketServer.launchedScanners() > 0) {
                    try {
                        const images = await webSocketServer.getImages(id);
                        const image = images[id];
                        await createAndUploadFromSource(image, id);
                        this.logger.success(`Created ${id} quest item images`);
                    } catch (error) {
                        this.logger.error(`Error creating ${id} quest item images ${error}`);
                    }
                }
                this.questItems[id].iconLink = itemData.icon_link || 'https://assets.tarkov.dev/unknown-item-icon.jpg';
                this.questItems[id].gridImageLink = itemData.grid_image_link || 'https://assets.tarkov.dev/unknown-item-grid-image.jpg';
                this.questItems[id].baseImageLink = itemData.base_image_link || 'https://assets.tarkov.dev/unknown-item-base-image.png';
                this.questItems[id].inspectImageLink = itemData.image_link || 'https://assets.tarkov.dev/unknown-item-inspect.webp';
                this.questItems[id].image512pxLink = itemData.image_512_link || 'https://assets.tarkov.dev/unknown-item-512.webp';
                this.questItems[id].image8xLink = itemData.image_8x_link || 'https://assets.tarkov.dev/unknown-item-512.webp';
            } else {
                this.logger.warn(`Quest item ${id} not found in DB`);
            }
            this.questItems[id].normalizedName = this.normalizeName(this.locales.en[this.questItems[id].name]);
        }

        if (missingImages.length > 0) {
            this.logger.warn(`${missingImages.length} quests are missing images`);
        }
        await fs.writeFile('./cache/quests_missing_images.json', JSON.stringify(missingImages, null, 4));

        quests.QuestItem = this.questItems;

        quests.Quest = await this.jobManager.runJob('update-quests-legacy', {data: this.tdQuests, parent: this});

        quests.Achievement = this.achievements.map(a => this.processAchievement(a));

        quests.locale = this.kvData.locale;

        await this.cloudflarePut(quests);

        const pveQuests = {
            ...quests,
        };
        const nonPveTraders = ['6617beeaa9cfa777ca915b7c'];
        pveQuests.Task = quests.Task.reduce((validTasks, task) => {
            if (nonPveTraders.includes(task.trader)) {
                return validTasks;
            }
            if (task.finishRewards.traderUnlock.some(unlock => nonPveTraders.includes(unlock.trader_id))) {
                return validTasks;
            }
            const pveTask = {
                ...task,
                startRewards: {
                    ...task.startRewards,
                    traderStanding: task.startRewards.traderStanding.filter(standing => {
                        return !nonPveTraders.includes(standing.trader_id);
                    }),
                    offerUnlock: task.startRewards.offerUnlock.filter(reward => {
                        return !nonPveTraders.includes(reward.trader_id);
                    }),
                },
                finishRewards: {
                    ...task.finishRewards,
                    traderStanding: task.finishRewards.traderStanding.filter(standing => {
                        return !nonPveTraders.includes(standing.trader_id);
                    }),
                    offerUnlock: task.finishRewards.offerUnlock.filter(reward => {
                        return !nonPveTraders.includes(reward.trader_id);
                    }),
                },
            };
            validTasks.push(pveTask);
            return validTasks;
        }, []);
        await this.cloudflarePut(pveQuests, `${this.kvName}_pve`);

        this.logger.success(`Finished processing ${quests.Task.length} quests`);
        return quests;
    }

    getQuestItemLocations = (questItemId, objectiveId) => {
        const foundItems = [];
        const forceMap = forceObjectiveMap[objectiveId];
        const spawnsPerMap = {};
        // first we get all the spawns we can from the SPT data
        for (const mapId in this.mapLoot) {
            if (!spawnsPerMap[mapId]) {
                spawnsPerMap[mapId] = 0;
            }
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
                // track how many spawn points we've found for each map
                spawnsPerMap[mapId] += spawns.length;
                foundItems.push({map: mapId, positions: spawns});
            }
        }
        for (const mapId in this.mapDetails) {
            if (forceMap && forceMap !== mapId) {
                continue;
            }
            const spawns = this.mapDetails[mapId].quest_items.reduce((allSpawns, q) => {
                if (q.id === questItemId) {
                    allSpawns.push(q.location.position);
                }
                return allSpawns;
            }, []);
            if (spawns.length === 0) {
                // we didn't find any spawns, so move on
                continue;
            }
            if (spawnsPerMap[mapId] === 1) {
                // this item only had one spawn in the SPT data, so we should replace
                foundItems.find(s => s.map === mapId).positions = spawns;
            } else if (!spawnsPerMap[mapId]) {
                // no spawns in SPT data, so we add
                foundItems.push({map: mapId, positions: spawns});
            }
            // if multiple spawns in spt data, we leave it alone
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

    getRewardItems = async (reward) => {
        if (reward.value > 1) {
            reward.items = reward.items.reduce((rewardItems, current, currentIndex) => {
                if (currentIndex === 0) {
                    rewardItems.push(current);
                } else if (current.parentId && rewardItems.some(r => r._id === current.parentId)) {
                    rewardItems.push(current);
                }
                return rewardItems;
            }, []);
        }
        const rewardData = {
            item: reward.items[0]._tpl,
            item_name: this.locales.en[`${reward.items[0]._tpl} Name`],
            count: 1,
            contains: [],
            attributes: []
        };
        if (reward.items[0].upd?.StackObjectsCount) {
            rewardData.count = reward.items[0].upd.StackObjectsCount;
        }
        for (let i = 1; i < reward.items.length; i++) {
            const item = reward.items[i];
            if (this.items[rewardData.item]._parent === '543be5cb4bdc2deb348b4568') {
                // skip ammo pack contents
                break;
            }
            if (this.items[item._tpl]._parent === '65649eb40bf0ed77b8044453') {
                // skip built-in armor inserts
                continue;
            }
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

        // check if item is armor
        const armorTypes = [
            '5448e54d4bdc2dcc718b4568',
            '5448e5284bdc2dcb718b4567',
        ];
        if (armorTypes.includes(this.items[rewardData.item]?._parent)) {
            // all armors are default presets
            const matchedPreset = Object.values(this.presets).find(preset => {
                return preset.baseId === rewardData.item && preset.default;
            });
            if (matchedPreset) {
                rewardData.item = matchedPreset.id;
                //rewardData.item_name = matchedPreset.name;
                rewardData.base_item_id = matchedPreset.baseId;
                rewardData.contains = [];
                return rewardData;
            }
        }
        // contains no items, so not a preset
        if (rewardData.contains.length === 0) {
            return rewardData;
        }

        let matchedPreset = Object.values(this.presets).find(preset => {
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

        if (!matchedPreset) {
            try {
                const presetImage = await webSocketServer.getJsonImage(reward);
                const matchedPresetData = await presetData.addJsonPreset(reward);
                matchedPreset = matchedPresetData.preset;
                await createAndUploadFromSource(presetImage, matchedPreset.id);
            } catch (error) {
                this.logger.error(`Error creating JSON preset: ${error.message}`);
            }
        } else {
            // update last_used value of preset
            // calling here ensures that only prior-existing presets
            // are updated instead of updating a newly-created one
            await presetData.presetUsed(matchedPreset.id);
        }

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
            this.logger.log(JSON.stringify(reward, null, 4));
        }
        return rewardData;
    }

    loadRewards = async (questData, rewardsType, sourceRewards) => {
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
                questData[rewardsType].items.push(await this.getRewardItems(reward));
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
                    ...await this.getRewardItems(reward)
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
                const rewardItems = reward.items.reduce((combined, current) => {
                    const existingItem = combined.find(i => i._tpl === current._tpl);
                    if (existingItem) {
                        existingItem.upd.StackObjectsCount += current.upd.StackObjectsCount;
                    } else {
                        combined.push(current);
                    }
                    return combined;
                }, []);
                questData[rewardsType].craftUnlock.push({
                    items: rewardItems.map(item => {
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

    addNeededKeys = (questData) => {
        const neededKeys = this.neededKeys[questData.id];
        if (!neededKeys) {
            return;
        }
        questData.neededKeys = [];
        for (const obj of questData.objectives) {
            if (!neededKeys[obj.id]) {
                continue;
            }
            obj.requiredKeys = neededKeys[obj.id];
            const mapId = obj.map_ids.length > 0 ? obj.map_ids[0] : null;
            for (const neededKey of neededKeys[obj.id]) {
                const newKeys = neededKey.filter(keyId => !questData.neededKeys.some(nk => nk.key_ids.includes(keyId) && nk.map_id === mapId));
                if (newKeys.length === 0) {
                    continue;
                }
                const mapNeeedKeys = questData.neededKeys.find(nk => nk.map_id === mapId);
                if (!mapNeeedKeys) {
                    questData.neededKeys.push({
                        key_ids: newKeys,
                        map_id: mapId,
                    });
                } else {
                    mapNeeedKeys.key_ids.push(...newKeys);
                }
            }
        }
    }

    formatRawQuest = async (quest) => {
        const questId = quest._id;
        this.logger.log(`Processing ${this.locales.en[`${questId} name`]} ${questId}`);
        /*if (!en.locations[quest.location]) {
            this.logger.warn(`Could not find location name for ${quest.location} of ${en.quest[questId].name}`);
            continue;
        }*/
        let locationName = 'any';
        let locationId = null;
        if (quest.location !== 'any' && quest.location !== 'marathon') {
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
            wikiLink: ``,
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
            if (req.conditionType === 'Level') {
                questData.minPlayerLevel = parseInt(req.value);
            } else if (req.conditionType === 'Quest') {
                const questReq = {
                    task: req.target,
                    name: this.locales.en[`${req.target} name`],
                    status: []
                };
                for (const statusCode of req.status) {
                    if (!questStatusMap[statusCode]) {
                        this.logger.warn(`Unrecognized quest status "${statusCode}" for quest requirement ${this.locales.en[req.target]} ${req.target} of ${questData.name}`);
                        continue;
                    }
                    questReq.status.push(questStatusMap[statusCode]);
                }
                questData.taskRequirements.push(questReq);
            } else if (req.conditionType === 'TraderLoyalty' || req.conditionType === 'TraderStanding') {
                const requirementTypes = {
                    TraderLoyalty: 'level',
                    TraderStanding: 'reputation',
                };
                questData.traderRequirements.push({
                    id: req.id,
                    trader_id: req.target,
                    name: this.locales.en[`${req.target} Nickname`],
                    requirementType: requirementTypes[req.conditionType],
                    compareMethod: req.compareMethod,
                    value: parseInt(req.value),
                    level: parseInt(req.value),
                });
            } else {
                this.logger.warn(`Unrecognized quest prerequisite type ${req.conditionType} for quest requirement ${req.id} of ${questData.name}`)
            }
        }
        await this.loadRewards(questData, 'finishRewards', quest.rewards.Success);
        await this.loadRewards(questData, 'startRewards', quest.rewards.Started);
        await this.loadRewards(questData, 'failureOutcome', quest.rewards.Fail);
        if (factionMap[questData.id]) questData.factionName = factionMap[questData.id];
        //if (this.missingQuests[questData.id]) delete this.missingQuests[questData.id];
    
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
        if (this.changedQuests[questId]?.objectivesRemoved?.includes(objective.id)) {
            return false;
        }
        if (!objective.id) {
            return false;
        }
        let objectiveId = objective.id;
        const changedIds = this.changedQuests[questId]?.objectiveIdsChanged;
        if (changedIds && changedIds[objectiveId]) {
            const objectiveIdChanged = changedIds[objectiveId];
            logger.warn(`Changing objective id ${objectiveId} to ${objectiveIdChanged}`);
            objectiveId = objectiveIdChanged;
        }

        const obj = {
            id: objectiveId,
            description: (!failConditions || this.locales.en[objectiveId]) ? this.addTranslation(objectiveId) : this.addTranslation(objectiveId, 'en', ''),
            type: null,
            count: isNaN(objective.value) ? null : parseInt(objective.value),
            optional: Boolean((objective.parentId)),
            locationNames: [],
            map_ids: [],
            zoneKeys: [],
            zoneNames: [],
        };
        if (objective.conditionType === 'FindItem' || objective.conditionType === 'HandoverItem' || objective.conditionType === 'SellItemToTrader') {
            const targetItem = this.items[objective.target[0]];
            let verb = 'give';
            if (objective.conditionType === 'FindItem' || (objective.conditionType === 'HandoverItem' && obj.optional)) {
                verb = 'find';
            }
            if (objective.conditionType === 'SellItemToTrader') {
                verb = 'sell';
            }
            obj.item_id = objective.target[0];
            obj.item_name = this.locales.en[`${objective.target[0]} Name`];
            //obj.count = parseInt(objective.value);
            if (!targetItem || targetItem._props.QuestItem) {
                obj.type = `${verb}QuestItem`;
                //obj.questItem = objective.target[0];
                this.questItems[objective.target[0]] = {
                    id: objective.target[0]
                };
                obj.possibleLocations = [];
            } else {
                obj.type = `${verb}Item`;
                obj.item = objective.target[0];
                obj.items = objective.target.filter(id => this.itemResults.has(id) && !this.itemResults.get(id).types.includes('disabled') && !this.itemResults.get(id).types.includes('quest'));
                obj.dogTagLevel = objective.dogtagLevel;
                obj.maxDurability = objective.maxDurability;
                obj.minDurability = objective.minDurability;
                obj.foundInRaid = Boolean(objective.onlyFoundInRaid);
            }
        } else if (objective.conditionType === 'CounterCreator') {
            const counter = objective.counter;
            for (const cond of counter.conditions) {
                if (cond.conditionType === 'VisitPlace') {
                    //obj.description = en.quest[questId].conditions[objective.id];
                    obj.zoneKeys.push(cond.target);
                } else if (cond.conditionType === 'Kills' || cond.conditionType === 'Shots') {
                    obj.target = this.locales.en[`QuestCondition/Elimination/Kill/Target/${cond.target}`] || cond.target;
                    //obj.count = parseInt(objective.value);
                    obj.shotType = 'kill';
                    if (cond.conditionType === 'Shots') obj.shotType = 'hit';
                    //obj.bodyParts = [];
                    if (cond.bodyPart) {
                        obj.bodyParts = this.addTranslation(cond.bodyPart.map(part => `QuestCondition/Elimination/Kill/BodyPart/${part}`));
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
                    if (cond.distance) {
                        obj.distance = cond.distance;
                    }
                    if (cond.weapon) {
                        for (const itemId of cond.weapon) {
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
                    if (cond.weaponModsInclusive) {
                        for (const modArray of cond.weaponModsInclusive) {
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
                    if (cond.enemyHealthEffects && cond.enemyHealthEffects.length > 0) {
                        obj.enemyHealthEffect = {
                            ...cond.enemyHealthEffects[0],
                            time: null,
                        };
                        if (cond.enemyHealthEffects[0].bodyParts) {
                            obj.bodyParts = this.addTranslation(cond.enemyHealthEffects[0].bodyParts.map(part => `QuestCondition/Elimination/Kill/BodyPart/${part}`));
                            obj.enemyHealthEffect.bodyParts = obj.bodyParts;
                        }
                        if (cond.enemyHealthEffects[0].effects) {
                            obj.effects = this.addTranslation(cond.enemyHealthEffects[0].effects.map(eff => {
                                if (eff === 'Stimulator') {
                                    return '5448f3a64bdc2d60728b456a Name';
                                }
                                return eff;
                            }));
                            obj.enemyHealthEffect.effects = obj.effects;
                        }
                    }
                    let targetCode = cond.target;
                    obj.targetNames = [this.addMobTranslation(targetCode)];
                    if (cond.savageRole?.length) {
                        const ignoreRoles = [
                            'assault',
                            'cursedAssault',
                            'followerStormtrooper',
                        ];
                        const allowedRoles = cond.savageRole.filter(role => !ignoreRoles.includes(role)).reduce((roles, role) => {
                            const key = this.getMobKey(role);
                            if (!roles.includes(key)) {
                                roles.push(key);
                            }
                            return roles;
                        }, []);
                        if (allowedRoles.length < 1) {
                            allowedRoles.push('savage');
                        }
                        obj.targetLocations = Array.from(allowedRoles.reduce((locs, mob) => {
                            locs = this.getMobMaps(mob, locs)
                            return locs;
                        }, obj.targetLocations));

                        targetCode = allowedRoles[0];
                        obj.targetNames = allowedRoles.map(key => this.addMobTranslation(key));
                    }
                    obj.target = obj.targetNames[0];
                    if (cond.daytime) {
                        obj.timeFromHour = cond.daytime.from;
                        obj.timeUntilHour = cond.daytime.to;
                    }
                } else if (cond.conditionType === 'Location') {
                    for (const loc of cond.target) {
                        if (loc === 'develop') continue;
                        const map = this.getMapFromNameId(loc);
                        if (map) {
                            obj.locationNames.push(map.name);
                            obj.map_ids.push(map.id);
                        } else {
                            this.logger.warn(`Unrecognized map name ${loc} for objective ${obj.id}`);
                        }
                    }
                } else if (cond.conditionType === 'ExitStatus') {
                    obj.exitStatus = this.addTranslation(cond.status.map(stat => `ExpBonus${stat}`));
                } else if (cond.conditionType === 'ExitName') {
                    obj.exitName = this.addTranslation(cond.exitName)
                    if (cond.exitName && obj.map_ids.length === 0) {
                        const mapIdWithExtract = Object.keys(this.mapDetails).find(mapId => {
                            const extracts = this.mapDetails[mapId].extracts;
                            return extracts.some(e => e.settings.Name === cond.exitName);
                        });
                        if (mapIdWithExtract) {
                            obj.map_ids.push(mapIdWithExtract);
                        } else {
                            this.logger.warn(`No map found for extract ${cond.exitName}`);
                        }
                    }
                } else if (cond.conditionType === 'Equipment') {
                    if (!obj.wearing) obj.wearing = [];
                    if (!obj.notWearing) obj.notWearing = [];
                    if (cond.equipmentInclusive) {
                        for (const outfit of cond.equipmentInclusive) {
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
                    if (cond.equipmentExclusive) {
                        for (const outfit of cond.equipmentExclusive) {
                            for (const itemId of outfit) {
                                obj.notWearing.push({
                                    id: itemId,
                                    name: this.locales.en[`${itemId} Name`]
                                });
                            }
                        }
                    }
                } else if (cond.conditionType === 'InZone') {
                    obj.zoneKeys.push(...cond.zoneIds);
                } else if (cond.conditionType === 'Shots') {
                    //already handled with Kills
                } else if (cond.conditionType === 'HealthEffect') {
                    obj.healthEffect = {
                        bodyParts: cond.bodyPartsWithEffects[0].bodyParts,
                        effects: cond.bodyPartsWithEffects[0].effects,
                        time: null,
                    };
                    if (cond.bodyPartsWithEffects[0].bodyParts) {
                        obj.bodyParts = this.addTranslation(cond.bodyPartsWithEffects[0].bodyParts.map(part => `QuestCondition/Elimination/Kill/BodyPart/${part}`));
                        obj.healthEffect.bodyParts = obj.bodyParts;
                    }
                    if (cond.bodyPartsWithEffects[0].effects) {
                        obj.effects = this.addTranslation(cond.bodyPartsWithEffects[0].effects.map(eff => {
                            if (eff === 'Stimulator') {
                                return '5448f3a64bdc2d60728b456a Name';
                            }
                            return eff;
                        }));
                        obj.healthEffect.effects = obj.effects;
                    }
                    if (cond.time) obj.healthEffect.time = cond.time;
                } else if (cond.conditionType === 'UseItem') {
                    obj.useAny = cond.target.filter(id => this.itemMap[id]).reduce((allItems, current) => {
                        if (!allItems.includes(current)) {
                            allItems.push(current);
                        }
                        return allItems;
                    }, []);
                    obj.compareMethod = cond.compareMethod;
                    obj.count = cond.value;
                } else if (cond.conditionType === 'LaunchFlare') {
                    obj.useAny = [
                        '624c0b3340357b5f566e8766',
                        '62389be94d5d474bf712e709',
                    ];
                    obj.count = 1;
                    obj.compareMethod = '>=';
                    obj.zoneKeys.push(cond.target);
                } else {
                    this.logger.warn(`Unrecognized counter condition type "${cond.conditionType}" for objective ${objective.id}`);
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
        } else if (objective.conditionType === 'PlaceBeacon') {
            obj.type = 'mark';
            obj.item = objective.target[0];
            obj.item_id = objective.target[0];
            obj.item_name = this.locales.en[`${objective.target[0]} Name`];
            obj.zoneKeys = [objective.zoneId];
        } else if (objective.conditionType === 'LeaveItemAtLocation') {
            obj.count = parseInt(objective.value);
            obj.zoneKeys = [objective.zoneId];
            if (this.items[objective.target[0]]._props.QuestItem) {
                obj.type = 'plantQuestItem';
                obj.item_id = objective.target[0];
                this.questItems[objective.target[0]] = {
                    id: objective.target[0]
                };
            } else {
                obj.type = 'plantItem';
                obj.item = objective.target[0];
                obj.items = objective.target.filter(id => this.itemResults.has(id) && !this.itemResults.get(id).types.includes('disabled'));
                obj.item_name = this.locales.en[`${objective.target[0]} Name`];
                obj.dogTagLevel = 0;
                obj.maxDurability = 100;
                obj.minDurability = 0;
                obj.foundInRaid = false;
            }
        } else if (objective.conditionType === 'Skill') {
            obj.type = 'skill';
            obj.skillLevel = {
                name: this.addTranslation(objective.target),
                level: objective.value,
            };
        } else if (objective.conditionType === 'WeaponAssembly') {
            obj.type = 'buildWeapon';
            obj.item = objective.target[0];
            obj.item_name = this.locales.en[`${objective.target[0]} Name`];
            objective.ergonomics.value = parseInt(objective.ergonomics.value);
            objective.recoil.value = parseInt(objective.recoil.value);
            obj.attributes = [
                {
                    name: 'accuracy',
                    requirement: objective.baseAccuracy
                },
                {
                    name: 'durability',
                    requirement: objective.durability
                },
                {
                    name: 'effectiveDistance',
                    requirement: objective.effectiveDistance
                },
                {
                    name: 'ergonomics',
                    requirement: objective.ergonomics
                },
                {
                    name: 'height',
                    requirement: objective.height
                },
                {
                    name: 'magazineCapacity',
                    requirement: objective.magazineCapacity
                },
                {
                    name: 'muzzleVelocity',
                    requirement: objective.muzzleVelocity
                },
                {
                    name: 'recoil',
                    requirement: objective.recoil
                },
                {
                    name: 'weight',
                    requirement: objective.weight
                },
                {
                    name: 'width',
                    requirement: objective.width
                }
            ];
            for (const att of obj.attributes) {
                att.requirement.value = parseFloat(att.requirement.value);
            }
            /*obj.accuracy = objective.baseAccuracy;
            obj.durability = objective.durability;
            obj.effectiveDistance = objective.effectiveDistance;
            obj.ergonomics = objective.ergonomics;
            obj.height = objective.height;
            obj.magazineCapacity = objective.magazineCapacity;
            obj.muzzleVelocity = objective.muzzleVelocity;
            obj.recoil = objective.recoil;
            obj.weight = objective.weight;
            obj.width = objective.width;
            obj.ergonomics.value = parseInt(obj.ergonomics.value);
            obj.recoil.value = parseInt(obj.recoil.value);*/
            obj.containsAll = [];
            obj.containsOne = [];
            obj.containsCategory = [];
            for (const itemId of objective.containsItems) {
                obj.containsAll.push({
                    id: itemId,
                    name: this.locales.en[`${itemId} Name`]
                });
            }
            for (const itemId of objective.hasItemFromCategory) {
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
        } else if (objective.conditionType === 'TraderLoyalty') {
            obj.type = 'traderLevel';
            obj.trader_id = objective.target;
            obj.trader_name = this.locales.en[`${objective.target} Nickname`];
            obj.level = objective.value;
        } else if (objective.conditionType === 'TraderStanding') {
            obj.type = 'traderStanding';
            obj.trader_id = objective.target;
            obj.trader_name = this.locales.en[`${objective.target} Nickname`];
            obj.compareMethod = objective.compareMethod;
            obj.value = objective.value;
        } else if (objective.conditionType === 'VisitPlace') {
            obj.type = 'visit';
        } else if (objective.conditionType === 'Quest') {
            obj.type = 'taskStatus';
            obj.task = objective.target;
            obj.quest_name = this.locales.en[`${objective.target} name`];
            obj.status = [];
            for (const statusCode of objective.status) {
                if (!questStatusMap[statusCode]) {
                    this.logger.warn(`Unrecognized quest status "${statusCode}" for quest objective ${this.locales.en[`${req.target}`]} ${req.target}`);
                    continue;
                }
                obj.status.push(questStatusMap[statusCode]);
            }
        } else if (objective.conditionType === 'Level') {
            obj.type = 'playerLevel';
            obj.playerLevel = parseInt(objective.value);
        } else {
            this.logger.warn(`Unrecognized type "${objective.conditionType}" for objective ${objective.id}`);
            return;
        }
        if (obj.zoneKeys.length > 0) {
            const reducedZones = obj.zoneKeys.reduce((reducedKeys, key) => {
                if (!this.locales.en[key]) {
                    if (obj.type === 'shoot' || obj.type === 'extract' || obj.type === 'useItem') {
                        this.logger.warn(`No translation for zone ${key} for objective ${objective.id}`);
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

    processAchievement(ach) {
        return {
            id: ach.id,
            name: this.addTranslation(`${ach.id} name`),
            normalizedName: this.normalizeName(this.getTranslation(`${ach.id} name`)),
            description: this.addTranslation(`${ach.id} description`),
            hidden: ach.hidden,
            side: this.addTranslation(ach.side),
            normalizedSide: this.normalizeName(this.getTranslation(ach.side)),
            rarity: this.addTranslation(`Achievements/Tab/${ach.rarity}Rarity`),
            normalizedRarity: this.normalizeName(this.getTranslation(`Achievements/Tab/${ach.rarity}Rarity`)),
            //conditions: ach.conditions.availableForFinish.map(c => this.formatObjective(ach.id, c, true)),
            playersCompletedPercent: this.achievementStats[ach.id] || 0,
            adjustedPlayersCompletedPercent: parseFloat((((this.achievementStats[ach.id] || 0) / this.achievementStats['65141c30ec10ff011f17cc3b']) * 100).toFixed(2)),
        };
    }

    getMobMaps(mobName, locationSet) {
        mobName = mobName.toLowerCase();
        return Object.keys(this.locations.locations).reduce((onMaps, mapId) => {
            const map = this.locations.locations[mapId];
            if (mapId !== '59fc81d786f774390775787e' && (!map.Enabled || map.Locked)) {
                return onMaps;
            }
            if (!this.maps.some(m => m.id === mapId)) {
                return onMaps;
            }
            if (mobName === 'savage' && map.waves.some(w => w.WildSpawnType === 'assault')) {
                onMaps.add(mapId);
            }
            if (mobName === 'marksman' && map.waves.some(w => w.WildSpawnType === 'marksman')) {
                onMaps.add(mapId);
            }
            const boss = map.BossLocationSpawn.some(spawn => {
                if (!spawn.BossChance) {
                    return false;
                }
                if (spawn.BossName.toLowerCase() === mobName) {
                    return true;
                }
                if (spawn.BossEscortAmount !== '0' && spawn.BossEscortType.toLowerCase() === mobName) {
                    return true;
                }
                return !!spawn.Supports?.some(support => {
                    return support.BossEscortAmount !== '0' && support.BossEscortType.toLowerCase() === mobName;
                });
            });
            if (boss) {
                onMaps.add(mapId);
            }
            return onMaps;
        }, locationSet || new Set());
    }

    async getTaskImageLink(task) {
        const s3FileName = `${task.id}.webp`;
        const s3ImageLink = `https://${process.env.S3_BUCKET}/${s3FileName}`;
        if (this.s3Images.includes(s3FileName)) {
            return s3ImageLink;
        }
        return null;
    }
}

const questItemLocations = {};

const extractMap = {};

const skipQuests = [
    '6603fe74e773dcf3b0099f88', // The Tarkov Mystery
    '6658a15615cbb1b2c6014d5b', // Hustle 2024
    '6672ec2a2b6f3b71be794cc5', // A Key to Salvation
    '668bcccc167d507eb01a268b', // Import Control
    '66a78dada472ad7f845b71f7', // Supply and Demand
    '66a74c628410476dd65543be', // Gunsmith - Special Order
    '66a75b44243a6548ff5e5ff9', // Gun Connoisseur
    '66a77394243a6548ff5e601d', // Customer Communication
    '668bccf963acb16d63707043', // What's Your Evidence?
    '668bcd1b194be70f18427a00', // Caught Red-Handed
    '66e01aca214f88109006a4b5', // Into the Inferno
    '66e01ad15a8890455a0d9eea', // In and Out
    '66e01ad6835f78499f049180', // Ours by Right
    '66e01adbd3d014f3ae061c12', // Provide Cover
    '66e01ae0c391e4c94903d220', // Cream of the Crop
    '66e01c4c475acf7e0102d296', // Before the Rain
    '66e3e2ee2136472d220bcb36', // Night of the Cult
    '66e3e2fcb26de0e0790d3fe6', // The Graven Image
    '66e3e3027804a21d860755d6', // Until Dawn
    '670404a2ea1caa8f2e0be106', // Don't Believe Your Eyes
    '67040b3d10b18d153a08f636', // Dirty Blood
    '67040b6c45eaf70db10dbec6', // Burn it Down
    '67040ba4578a46e44a05c0a8', // The Root Cause
    '67040c22cc1f3752720376e9', // Matter of Technique
    '67040c43ce929d6ee506c7c7', // Find the Source
    '67040c5b4ac6d9c18c0ade26', // Gloves Off
    '67040c78bf4be8a4ef041a65', // Sample IV - A New Hope
    '67040c92bf4be8a4ef041a6c', // Darkest Hour Is Just Before Dawn
    '6727ef2c6015b7cc540ea754', // Contagious Beast
    '67190f6c1b3f4964d90d71e9', // Global Threat
    '67190f9c7b0991dc22064766', // Watch the Watcher
    '67040cae4ac6d9c18c0ade2c', // Radical Treatment
    '67040ccdcc1f3752720376ef', // Forgotten Oaths
    '6707e6614e617ec94f0e63dc', // Clear Conscience
    '67190febcce4a5fdf605d4f8', // Not a Step Back!
    '671910d5dbd4354ac10e9784', // Conservation Area
    '6719116460f6f081570d05f7', // Every Man for Himself
    '67191048eddf081d340d4c6e', // Pressured by Circumstances
    '671911bbcee3738f8502d401', // Reduce the Distance
    '6719101deddf081d340d4c60', // Spread the Damage
    '67190f157b0991dc22064755', // Foreign Support
    '67165d59a9c06627040a9094', // Forces Measure
    '674647f38466ebb03408b291', // That's a Great Plan, Walter
];

// Secure Folder 0013 appears on multiple maps
// this restricts a particular objective to being found on one map
const forceObjectiveMap = {
    '5a2819c886f77460ba564f38': '5704e554d2720bac5b8b456e',
    '5979fc2686f77426d702a0f2': '56f40101d2720b2a4d8b45d6',
    '5a3fbe3a86f77414422e0d9b': '5704e3c2d2720bac5b8b4567',
};

const questStatusMap = {
    2: 'active',
    4: 'complete',
    5: 'failed'
};

const factionMap = {
    '5e381b0286f77420e3417a74': 'USEC', // Textile - Part 1
    '5e4d4ac186f774264f758336': 'USEC', // Textile - Part 2
    '6179b5eabca27a099552e052': 'USEC', // Counteraction
    '639282134ed9512be67647ed': 'USEC', // Road Closed
    '5e383a6386f77465910ce1f3': 'BEAR', // Textile - Part 1
    '5e4d515e86f77438b2195244': 'BEAR', // Textile - Part 2
    '6179b5b06e9dd54ac275e409': 'BEAR', // Our Own Land
    '639136d68ba6894d155e77cf': 'BEAR', // Green Corridor
    '6613f3007f6666d56807c929': 'BEAR', // Drip-Out - Part 1
    '66151401efb0539ae10875ae': 'USEC', // Drip-Out - Part 1
    '6613f307fca4f2f386029409': 'BEAR', // Drip-Out - Part 2
    '6615141bfda04449120269a7': 'USEC', // Drip-Out - Part 2
};

export default UpdateQuestsJob;
