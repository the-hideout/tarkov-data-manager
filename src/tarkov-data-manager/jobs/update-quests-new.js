const fs = require('fs');
const path = require('path');

const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');

let logger = false;
let en = {};
let items = {};
let presets = {};
const questStatusMap = {
    2: 'active',
    4: 'complete',
    5: 'failed'
};

const mobMap = {
    AnyPmc: 'PMC',
    pmcBot: 'Raider',
    marksman: 'Sniper Scav',
    followerBully: 'Reshala Guard',
    exUsec: 'Rogue'
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
    lijnik_storage_area_1: 'Underground Warehouse'
};

const getRewardItems = (reward) => {
    const rewardData = {
        item: reward.items[0]._tpl,
        item_name: en.templates[reward.items[0]._tpl].Name,
        count: 1,
        contains: []
    };
    if (reward.items[0].upd) {
        rewardData.count = reward.items[0].upd.StackObjectsCount;
    }
    for (let i = 1; i < reward.items.length; i++) {
        const item = reward.items[i];
        const containedItem = {
            item: item._tpl,
            name: en.templates[item._tpl].Name,
            slot: item.slotId,
            count: 1
        };
        if (item.upd) {
            containedItem.count = item.upd.StackObjectsCount;
        }
        rewardData.contains.push(containedItem);
    }
    for (const presetId in presets) {
        const preset = presets[presetId];
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
            logger.success('successfully matched '+preset.name);
            rewardData.item = preset.id;
            rewardData.item_name = preset.name;
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
};

const loadRewards = (questData, rewardsType, sourceRewards) => {
    for (const reward of sourceRewards) {
        if (reward.type === 'Experience') {
            questData.experience = parseInt(reward.value);
        } else if (reward.type === 'TraderStanding') {
            questData[rewardsType].traderStanding.push({
                trader: reward.target,
                name: en.trading[reward.target].Nickname,
                standing: parseFloat(reward.value)
            });
        } else if (reward.type === 'Item') {
            questData[rewardsType].item.push(getRewardItems(reward));
        } else if (reward.type === 'AssortmentUnlock') {
            if (!en.templates[reward.items[0]._tpl]) {
                logger.warn(`No name found for unlock item "${reward.items[0]._tpl}" for completion reward ${reward.id} of ${questData.name}`);
                continue;
            }
            let unlock = {
                offer_id: reward.id,
                trader_id: reward.traderId,
                trader_name: en.trading[reward.traderId].Nickname,
                min_level: reward.loyaltyLevel,
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
                ...getRewardItems(reward)
            };
            questData[rewardsType].offerUnlock.push(unlock);
        } else if (reward.type === 'Skill') {
            questData[rewardsType].skill.push({
                name: reward.target,
                level: parseInt(reward.value) / 100
            });
        } else if (reward.type === 'TraderUnlock') {
            questData[rewardsType].traderUnlock.push({
                trader: reward.target,
                trader_name: en.trading[reward.target].Nickname
            });
        } else {
            logger.warn(`Unrecognized reward type "${reward.type}" for ${rewardsType} reward ${reward.id} of ${questData.name}`);
        }
    }
};

module.exports = async () => {
    logger = new JobLogger('update-quests-new');
    try {
        logger.log('Processing quests...');
        const data = await tarkovChanges.quests();
        items = await tarkovChanges.items();
        en = await tarkovChanges.locale_en();
        try {
            presets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cache', 'presets.json')));
        } catch (error) {
            logger.error(error);
        }
        const quests = {
            updated: new Date(),
            data: [],
        };
        for (const questId in data) {
            const quest = data[questId];
            logger.log(`Processing ${en.quest[questId].name} ${questId}`);
            /*if (!en.locations[quest.location]) {
                logger.warn(`Could not find location name for ${quest.location} of ${en.quest[questId].name}`);
                continue;
            }*/
            let locationName = 'any';
            if (quest.location !== 'any') {
                locationName = en.locations[quest.location].Name;
            }
            const questData = {
                id: questId,
                name: en.quest[questId].name,
                trader: quest.traderId,
                trderName: en.trading[quest.traderId].Nickname,
                location_id: quest.location,
                locationName: locationName,
                wikiLink: `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(en.quest[questId].name.replaceAll(' ', '_'))}`,
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
                    item: [],
                    offerUnlock: [],
                    skill: [],
                    traderUnlock: []
                },
                finishRewards: {
                    traderStanding: [],
                    item: [],
                    offerUnlock: [],
                    skill: [],
                    traderUnlock: []
                },
                experience: 0
            }
            for (const objective of quest.conditions.AvailableForFinish) {
                let optional = false;
                if (objective._props.parentId) {
                    optional = true;
                }
                const obj = {
                    id: objective._props.id,
                    type: null,
                    optional: optional,
                    description: en.quest[questId].conditions[objective._props.id],
                    locationNames: []
                };
                if (objective._parent === 'FindItem' || objective._parent === 'HandoverItem') {
                    const targetItem = items[objective._props.target[0]];
                    let verb = 'give';
                    if (objective._parent === 'FindItem' || (objective._parent === 'HandoverItem' && optional)) {
                        verb = 'find';
                    }
                    obj.item_id = objective._props.target[0];
                    obj.item_name = en.templates[objective._props.target[0]].Name;
                    obj.count = parseInt(objective._props.value);
                    if (targetItem._props.QuestItem) {
                        obj.type = `${verb}QuestItem`;
                        obj.questItem = {
                            id: objective._props.target[0],
                            name: en.templates[objective._props.target[0]].Name
                        }
                    } else {
                        obj.type = `${verb}Item`;
                        obj.item = objective._props.target[0];
                        obj.dogTagLevel = objective._props.dogtagLevel;
                        obj.maxDurability = objective._props.maxDurability;
                        obj.minDurability = objective._props.minDurability;
                        obj.foundInRaid = (objective._props.onlyFoundInRaid != 0);
                    }
                } else if (objective._parent === 'CounterCreator') {
                    const counter = objective._props.counter;
                    const zoneKeys = [];
                    for (const cond of counter.conditions) {
                        if (cond._parent === 'VisitPlace') {
                            //obj.description = en.quest[questId].conditions[objective._props.id];
                        } else if (cond._parent === 'Kills' || cond._parent === 'Shots') {
                            obj.target = en.interface[`QuestCondition/Elimination/Kill/Target/${cond._props.target}`] || cond._props.target;
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
                                    obj.usingWeapon.push({
                                        id: itemId,
                                        name: en.templates[itemId].Name
                                    });
                                }
                            }
                            if (cond._props.weaponModsInclusive) {
                                for (const modArray of cond._props.weaponModsInclusive) {
                                    const modSet = [];
                                    for (const itemId of modArray) {
                                        if (!en.templates[itemId]) {
                                            logger.warn(`Unrecognized weapon mod ${itemId} for objective ${obj.id} of ${questData.name}`);
                                            continue;
                                        }
                                        modSet.push({
                                            id: itemId,
                                            name: en.templates[itemId].Name
                                        })
                                    }
                                    obj.usingWeaponMods.push(modSet);
                                }
                            }
                            if (cond._props.enemyHealthEffects) {
                                obj.enemyHealthEffects = {
                                    ...cond._props.enemyHealthEffects[0],
                                    time: null
                                };
                            }
                            if (cond._props.savageRole) {
                                obj.target = en.interface[`QuestCondition/Elimination/Kill/BotRole/${cond._props.savageRole[0]}`] || cond._props.savageRole[0];
                            }
                            if (mobMap[obj.target]) obj.target = mobMap[obj.target];
                        } else if (cond._parent === 'Location') {
                            if (!obj.locationNames) obj.locationNames = [];
                            for (const loc of cond._props.target) {
                                if (loc === 'develop') continue;
                                if (!en.interface[loc]) {
                                    logger.warn(`Unrecognized location ${loc} for objective ${obj.id} of ${questData.name} ${questData.id}`);
                                    continue;
                                }
                                obj.locationNames.push(en.interface[loc]);
                            }
                        } else if (cond._parent === 'ExitStatus') {
                            obj.exitStatus = cond._props.status;
                            obj.zoneNames = [];
                        } else if (cond._parent === 'Equipment') {
                            if (!obj.wearing) obj.wearing = [];
                            if (!obj.notWearing) obj.notWearing = [];
                            if (cond._props.equipmentInclusive) {
                                for (const outfit of cond._props.equipmentInclusive) {
                                    outfitData = [];
                                    for (const itemId of outfit) {
                                        outfitData.push({
                                            id: itemId,
                                            name: en.templates[itemId].Name
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
                                            name: en.templates[itemId].Name
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
                            logger.warn(`Unrecognized counter condition type "${cond._parent}" for objective ${objective._props.id} of ${questData.name}`);
                        }
                    }
                    if (obj.target) {
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
                                logger.warn(`Unrecognized zone ${key} for objective ${objective._props.id} of ${questData.name}`)
                            }
                        }
                    }
                } else if (objective._parent === 'PlaceBeacon') {
                    obj.type = 'mark';
                    obj.item = objective._props.target[0];
                    obj.item_id = objective._props.target[0];
                    obj.item_name = en.templates[objective._props.target[0]].Name;
                } else if (objective._parent === 'LeaveItemAtLocation') {
                    obj.count = parseInt(objective._props.value);
                    if (items[objective._props.target[0]].QuestItem) {
                        obj.type = 'plantQuestItem';
                        obj.questItem = {
                            id: objective._props.target[0],
                            name: en.templates[objective._props.target[0]].Name
                        };
                    } else {
                        obj.type = 'plantItem';
                        obj.item = objective._props.target[0];
                        obj.item_name = en.templates[objective._props.target[0]].Name;
                        obj.dogTagLevel = 0;
                        obj.maxDurability = 100;
                        obj.minDurability = 0;
                        obj.foundInRaid = false;
                    }
                } else if (objective._parent === 'Skill') {
                    obj.type = 'skill';
                    obj.skillLevel = {
                        name: objective._props.target,
                        level: objective._props.value
                    };
                } else if (objective._parent === 'WeaponAssembly') {
                    obj.type = 'buildWeapon';
                    obj.item = objective._props.target[0];
                    obj.item_name = en.templates[objective._props.target[0]].Name;
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
                    for (const itemId of objective._props.containsItems) {
                        obj.containsAll.push({
                            id: itemId,
                            name: en.templates[itemId].Name
                        });
                    }
                    for (const itemId of objective._props.hasItemFromCategory) {
                        for (const partId in items) {
                            if (items[partId]._parent === itemId) {
                                obj.containsOne.push({
                                    id: partId,
                                    name: en.templates[partId].Name
                                });
                            }
                        }
                    }
                } else if (objective._parent === 'TraderLoyalty') {
                    obj.type = 'traderLevel';
                    obj.trader_id = objective._props.target;
                    obj.trader_name = en.trading[objective._props.target].Nickname;
                    obj.traderLevel = objective._props.value;
                } else if (objective._parent === 'VisitPlace') {
                    obj.type = 'visit';
                } else if (objective._parent === 'Quest') {
                    obj.type = 'taskStatus';
                    obj.task = objective._props.target;
                    obj.quest_name = en.quest[objective._props.target].name;
                    obj.status = [];
                    for (const statusCode of objective._props.status) {
                        if (!questStatusMap[statusCode]) {
                            logger.warn(`Unrecognized quest status "${statusCode}" for quest objective ${en.quest[req._props.target].name} ${req._props.target} of ${questData.name}`);
                            continue;
                        }
                        obj.status.push(questStatusMap[statusCode]);
                    }
                } else if (objective._parent === 'Level') {
                    obj.type = 'playerLevel';
                    obj.playerLevel = parseInt(objective._props.value);
                } else {
                    logger.warn(`Unrecognized type "${objective._parent}" for objective ${objective._props.id} of ${questData.name}`);
                    continue;
                }
                questData.objectives.push(obj);
            }
            for (const req of quest.conditions.AvailableForStart) {
                if (req._parent === 'Level') {
                    questData.minPlayerLevel = parseInt(req._props.value);
                } else if (req._parent === 'Quest') {
                    const questReq = {
                        task: req._props.target,
                        name: en.quest[req._props.target].name,
                        status: []
                    };
                    for (const statusCode of req._props.status) {
                        if (!questStatusMap[statusCode]) {
                            logger.warn(`Unrecognized quest status "${statusCode}" for quest requirement ${en.quest[req._props.target].name} ${req._props.target} of ${questData.name}`);
                            continue;
                        }
                        questReq.status.push(questStatusMap[statusCode]);
                    }
                    questData.taskRequirements.push(questReq);
                } else if (req._parent === 'TraderLoyalty') {
                    questData.traderLevelRequirements.push({
                        id: req._props.id,
                        trader_id: req._props.target,
                        name: en.trading[req._props.target].Nickname,
                        level: parseInt(req._props.value)
                    });
                } else {
                    logger.warn(`Unrecognized quest prerequisite type ${req._parent} for quest requirement ${req._props.id} of ${questData.name}`)
                }
            }
            loadRewards(questData, 'finishRewards', quest.rewards.Success);
            loadRewards(questData, 'startRewards', quest.rewards.Started);
            quests.data.push(questData);
        }

        logger.log('Writing quests.json...');
        fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'tasks.json'), JSON.stringify(quests, null, 4));
        fs.writeFileSync(path.join(__dirname, '..', 'cache', 'tasks.json'), JSON.stringify(quests.data, null, 4));

        const response = await cloudflare(`/values/TASK_DATA`, 'PUT', JSON.stringify(quests)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of TASK_DATA');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
        }
        for (let i = 0; i < response.messages.length; i++) {
            logger.error(response.messages[i]);
        }
        logger.success(`Finished processing ${quests.data.length} quests`);
    } catch (error){
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
}