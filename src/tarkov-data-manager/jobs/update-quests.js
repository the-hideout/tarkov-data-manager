const fs = require('fs');
const path = require('path');

const got = require('got');

const { query, jobComplete } = require('../modules/db-connection');
const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');
const legacyQuests = require('./update-quests-legacy');

let logger = false;
let en = {};
let locales = {};
let items = {};
let presets = {};
let tdQuests = false;
let tdTraders = false;
let tdMaps = false;

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
    lijnik_storage_area_1: 'Underground Warehouse'
};

const factionMap = {
    '5e381b0286f77420e3417a74': 'USEC',
    '5e4d4ac186f774264f758336': 'USEC',
    '6179b5eabca27a099552e052': 'USEC',
    '5e383a6386f77465910ce1f3': 'BEAR',
    '5e4d515e86f77438b2195244': 'BEAR',
    '6179b5b06e9dd54ac275e409': 'BEAR'
};

const traderIdMap = {
    0: '54cb50c76803fa8b248b4571',
    1: '54cb57776803fa99248b456e',
    2: '58330581ace78e27b8b10cee',
    3: '5935c25fb3acc3127c3d8cd9',
    4: '5a7c2eca46aef81a7ca2145d',
    5: '5ac3b934156ae10c4430e83c',
    6: '5c0647fdd443bc2504c2d371',
    7: '579dc571d53a0658a154fbec',
};

const mapIdByName = {
    'Night Factory': '59fc81d786f774390775787e',
    'Factory': '55f2d3fd4bdc2d5f408b4567',
    'Lighthouse': '5704e4dad2720bb55b8b4567',
    'Customs': '56f40101d2720b2a4d8b45d6',
    'Reserve': '5704e5fad2720bc05b8b4567',
    'Interchange': '5714dbc024597771384a510d',
    'Shoreline': '5704e554d2720bac5b8b456e',
    'Woods': '5704e3c2d2720bac5b8b4567',
    'The Lab': '5b0fc42d86f7744a585f9105'
};

const getTarget = (cond, langCode) => {
    let targetCode = cond._props.target;
    if (cond._props.savageRole) {
        targetCode = cond._props.savageRole[0];
    }
    const lang = locales[langCode];
    if (targetCode == 'followerBully') {
        return `${lang.interface['QuestCondition/Elimination/Kill/BotRole/bossBully']} ${lang.interface['ScavRole/Follower']}`;
    }
    if (targetKeyMap[targetCode]) targetCode = targetKeyMap[targetCode];
    return lang.interface[`QuestCondition/Elimination/Kill/BotRole/${targetCode}`] 
        || lang.interface[`QuestCondition/Elimination/Kill/Target/${targetCode}`] 
        || lang.interface[`ScavRole/${targetCode}`] 
        || targetCode;
};

const getTdLocation = id => {
    for (const name in tdMaps) {
        const map = tdMaps[name];
        if (map.id === id) return map.locale.en;
    }
};

const getRewardItems = (reward) => {
    const rewardData = {
        item: reward.items[0]._tpl,
        item_name: en.templates[reward.items[0]._tpl].Name,
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
};

const loadRewards = (questData, rewardsType, sourceRewards) => {
    for (const reward of sourceRewards) {
        if (reward.type === 'Experience') {
            questData.experience = parseInt(reward.value);
        } else if (reward.type === 'TraderStanding') {
            questData[rewardsType].traderStanding.push({
                trader_id: reward.target,
                name: en.trading[reward.target].Nickname,
                standing: parseFloat(reward.value)
            });
        } else if (reward.type === 'Item') {
            questData[rewardsType].items.push(getRewardItems(reward));
        } else if (reward.type === 'AssortmentUnlock') {
            if (!en.templates[reward.items[0]._tpl]) {
                logger.warn(`No name found for unlock item "${reward.items[0]._tpl}" for completion reward ${reward.id} of ${questData.name}`);
                continue;
            }
            let unlock = {
                id: reward.id,
                trader_id: reward.traderId,
                trader_name: en.trading[reward.traderId].Nickname,
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
                ...getRewardItems(reward)
            };
            questData[rewardsType].offerUnlock.push(unlock);
        } else if (reward.type === 'Skill') {
            const skillLevel = {
                name: en.interface[reward.target],
                level: parseInt(reward.value) / 100,
                locale: {}
            };
            for (const code in locales) {
                skillLevel.locale[code] = {
                    name: locales[code].interface[reward.target] || reward.target
                };
            }
            questData[rewardsType].skillLevelReward.push(skillLevel);
        } else if (reward.type === 'TraderUnlock') {
            questData[rewardsType].traderUnlock.push({
                trader_id: reward.target,
                trader_name: en.trading[reward.target].Nickname
            });
        } else {
            logger.warn(`Unrecognized reward type "${reward.type}" for ${rewardsType} reward ${reward.id} of ${questData.name}`);
        }
    }
};

const mergeTdQuest = (questData, tdQuest) => {
    if (!tdQuest) {
        for (const q of tdQuests) {
            if (q.id === questData.tarkovDataId) {
                tdQuest = q;
                break;
            }
        }
    }
    if (!tdQuest) return;
    for (const tdObj of tdQuest.objectives) {
        if (tdObj.type === 'key') {
            key = {
                key_ids: [tdObj.target]
            };
            if (Array.isArray(tdObj.target)) key.key_ids = tdObj.target;
            key.locationName = null;
            key.map_id = null;
            if (tdObj.location > -1) {
                key.locationName = getTdLocation(tdObj.location);
                key.map_id = tdObj.location;
            }
            questData.neededKeys.push(key);
        }
    }
};

const formatTdQuest = (quest) => {
    const questData = {
        id: quest.gameId,
        name: quest.title,
        trader: traderIdMap[quest.giver],
        //traderName: traderIdMap[quest.giver],
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
            traderUnlock: []
        },
        finishRewards: {
            traderStanding: [],
            items: [],
            offerUnlock: [],
            skillLevelReward: [],
            traderUnlock: []
        },
        experience: quest.exp,
        tarkovDataId: quest.id,
        factionName: 'Any',
        neededKeys: []
    };
    for (const tdId of quest.require.quests) {
        for (const preQuest of tdQuests) {
            if (preQuest.id === tdId) {
                if (preQuest.gameId) {
                    questData.taskRequirements.push({
                        task: preQuest.gameId,
                        name: en.quest[preQuest.gameId].name,
                        status: ['complete']
                    });
                } else {
                    logger.warn(`No gameId found for prerequisite quest ${preQuest.title} ${tdId}`);
                }
                break;
            }
        }
    }
    for (const id of quest.unlocks) {
        questData.finishRewards.offerUnlock.push({
            id: `${id}-unlock`,
            trader_id: traderIdMap[quest.giver],
            level: null,
            item: id,
            count: 1,
            contains: [],
            attributes: []
        })
    }
    for (const rep of quest.reputation) {
        questData.finishRewards.traderStanding.push({
            trader_id: traderIdMap[rep.trader],
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
            obj.locationNames.push(getTdLocation(objective.location))
            obj.map_ids.push(objective.location);
        }
        if (objective.type === 'find' || objective.type === 'collect' || objective.type === 'pickup') {
            // find is find in raid, collect is not FIR
            // pickup is quest item
            obj.count = objective.number;
            if (objective.type === 'pickup') {
                obj.type = `findQuestItem`;
                obj.questItem = {
                    id: null,
                    name: objective.target
                }
                obj.description = `Obtain ${objective.target}`;
            } else {
                obj.type = `findItem`;
                obj.item_id = objective.target;
                obj.item_name = en.templates[objective.target].Name;
                obj.item = objective.target;
                obj.dogTagLevel = 0;
                obj.maxDurability = 0;
                obj.minDurability = 100;
                obj.foundInRaid = objective.type === 'find';
                obj.description = `Find ${en.templates[objective.target].Name}`;
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
                obj.questItem = {
                    id: null,
                    name: objective.target
                };
            } else {
                obj.type = 'plantItem';
                obj.item = objective.target;
                obj.item_name = en.templates[objective.target].Name;
                obj.dogTagLevel = 0;
                obj.maxDurability = 100;
                obj.minDurability = 0;
                obj.foundInRaid = false;
            }
            obj.description = `Place ${en.templates[objective.target].Name}`;
            if (objective.hint) obj.description += ` at ${objective.hint}`;
        } else if (objective.type === 'mark') {
            obj.type = 'mark';
            obj.item = objective.target;
            obj.item_id = objective.target;
            obj.item_name = en.templates[objective.target].Name;
        } else if (objective.type === 'skill') {
            obj.type = 'skill';
            obj.skillLevel = {
                name: objective.target,
                level: objective.number
            };
        } else if (objective.type === 'reputation') {
            obj.type = 'traderLevel';
            obj.trader_id = traderIdMap[objective.target];
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
                key.locationName = getTdLocation(objective.location);
                key.map_id = objective.location;
            }
            questData.neededKeys.push(key);
        }
        questData.objectives.push(obj);
    }
    return questData;
};

module.exports = async (externalLogger = false) => {
    logger = externalLogger || new JobLogger('update-quests');
    try {
        logger.log('Processing quests...');
        logger.log('Retrieving TarkovTracker quests.json...');
        tdQuests = (await got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/quests.json', {
            responseType: 'json',
            resolveBodyOnly: true
        }));
        const data = await tarkovChanges.quests();
        items = await tarkovChanges.items();
        en = await tarkovChanges.locale_en();
        locales = await tarkovChanges.locales();
        //const itemMap = await remoteData.get();
        const itemResults = await query(`
            SELECT
                item_data.*,
                GROUP_CONCAT(DISTINCT types.type SEPARATOR ',') AS types
            FROM
                item_data
            LEFT JOIN types ON
                types.item_id = item_data.id
            GROUP BY
                item_data.id
        `);
        const itemMap = new Map();
        for(const result of itemResults){
            Reflect.deleteProperty(result, 'item_id');
            Reflect.deleteProperty(result, 'base_price');

            const preparedData = {
                ...result,
                types: result.types?.split(',') || []
            };
            if (!preparedData.properties) preparedData.properties = {};
            itemMap.set(result.id, preparedData);
        }
        const missingQuests = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'missing_quests.json')));
        const changedQuests = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'changed_quests.json')));
        const removedQuests = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'removed_quests.json')));
        try {
            presets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cache', 'presets.json')));
        } catch (error) {
            logger.error(error);
        }
        const tdMatched = [];
        const quests = {
            updated: new Date(),
            data: [],
        };
        for (const questId in data) {
            if (removedQuests[questId]) continue;
            const quest = data[questId];
            logger.log(`Processing ${en.quest[questId].name} ${questId}`);
            /*if (!en.locations[quest.location]) {
                logger.warn(`Could not find location name for ${quest.location} of ${en.quest[questId].name}`);
                continue;
            }*/
            let locationName = 'any';
            let locationId = null;
            if (quest.location !== 'any') {
                locationName = en.locations[quest.location].Name;
                locationId = quest.location;
            }
            const questData = {
                id: questId,
                name: en.quest[questId].name,
                trader: quest.traderId,
                traderName: en.trading[quest.traderId].Nickname,
                location_id: locationId,
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
                    items: [],
                    offerUnlock: [],
                    skillLevelReward: [],
                    traderUnlock: []
                },
                finishRewards: {
                    traderStanding: [],
                    items: [],
                    offerUnlock: [],
                    skillLevelReward: [],
                    traderUnlock: []
                },
                experience: 0,
                tarkovDataId: undefined,
                factionName: 'Any',
                neededKeys: [],
                locale: {}
            };
            for (const code in locales) {
                const lang = locales[code];
                questData.locale[code] = {
                    name: lang.quest[questId]? lang.quest[questId].name : locales.en.quest[questId].name
                };
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
                    locationNames: [],
                    map_ids: [],
                    locale: {}
                };
                for (const code in locales) {
                    const lang = locales[code];
                    obj.locale[code] = {
                        description: lang.quest[questId] ? lang.quest[questId].conditions[objective._props.id] : locales.en.quest[questId].conditions[objective._props.id]
                    };
                }
                if (objective._parent === 'FindItem' || objective._parent === 'HandoverItem') {
                    const targetItem = items[objective._props.target[0]];
                    let verb = 'give';
                    if (objective._parent === 'FindItem' || (objective._parent === 'HandoverItem' && optional)) {
                        verb = 'find';
                    }
                    obj.item_id = objective._props.target[0];
                    obj.item_name = en.templates[objective._props.target[0]].Name;
                    obj.count = parseInt(objective._props.value);
                    if (!targetItem || targetItem._props.QuestItem) {
                        obj.type = `${verb}QuestItem`;
                        obj.questItem = {
                            id: objective._props.target[0],
                            name: en.templates[objective._props.target[0]].Name,
                            locale: {}
                        }
                        for (const code in locales) {
                            const lang = locales[code];
                            obj.questItem.locale[code] = {
                                name: lang.templates[objective._props.target[0]] ? lang.templates[objective._props.target[0]].Name : locales.en.templates[objective._props.target[0]]
                            };
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
                                        if (!itemMap.has(itemId) || itemMap.get(itemId).types.includes('disabled')) {
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
                            obj.target = getTarget(cond, 'en');
                            for (const code in locales) {
                                //const lang = locales[code];
                                obj.locale[code].target = getTarget(cond, code);
                            }
                        } else if (cond._parent === 'Location') {
                            for (const loc of cond._props.target) {
                                if (loc === 'develop') continue;
                                if (!en.interface[loc]) {
                                    logger.warn(`Unrecognized location ${loc} for objective ${obj.id} of ${questData.name} ${questData.id}`);
                                    continue;
                                }
                                let mapName = en.interface[loc];
                                obj.locationNames.push(mapName);
                                if (mapName === 'Laboratory') mapName = 'The Lab';
                                if (mapIdByName[mapName]) {
                                    obj.map_ids.push(mapIdByName[mapName]);
                                } else {
                                    logger.warn(`Unrecognized map name ${mapName} for objective ${obj.id} of ${questData.name} ${questData.id}`);
                                }
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
                    if (items[objective._props.target[0]]._props.QuestItem) {
                        obj.type = 'plantQuestItem';
                        obj.questItem = {
                            id: objective._props.target[0],
                            name: en.templates[objective._props.target[0]].Name,
                            locale: {}
                        };
                        for (const code in locales) {
                            const lang = locales[code];
                            obj.questItem.locale[code] = {
                                name: lang.templates[objective._props.target[0]].Name
                            };
                        }
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
                        name: en.interface[objective._props.target],
                        level: objective._props.value,
                        locale: {}
                    };
                    for (const code in locales) {
                        obj.skillLevel.locale[code] = {
                            name: locales[code].interface[objective._props.target]
                        }
                    }
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
                            if (!itemMap.has(itemId) || itemMap.get(itemId).types.includes('disabled')) {
                                continue;
                            }
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
                    obj.level = objective._props.value;
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
                if (changedQuests[questData.id]?.objectivesChanged && changedQuests[questData.id]?.objectivesChanged[obj.id]) {
                    for (const key of Object.keys(changedQuests[questData.id].objectivesChanged[obj.id])) {
                        obj[key] = changedQuests[questData.id].objectivesChanged[obj.id][key];
                    }
                }
                questData.objectives.push(obj);
            }
            if (changedQuests[questData.id] && changedQuests[questData.id].objectivesAdded) {
                for (const newObj of changedQuests[questData.id].objectivesAdded) {
                    if (!newObj.locale) newObj.locale = {};
                    for (const code in locales) {
                        if (!newObj.locale[code]) newObj.locale[code] = {};
                        const lang = locales[code];
                        newObj.locale[code].description = lang.quest[questId].conditions[newObj.id];
                        if (newObj.locale_map) {
                            for (const key in newObj.locale_map) {
                                newObj.locale[code][key] = lang.interface[newObj.locale_map[key]];
                            }
                        }
                    }
                    questData.objectives.push(newObj);
                }
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
            if (changedQuests[questData.id] && changedQuests[questData.id].finishRewardsAdded) {
                for (const rewardType in changedQuests[questData.id].finishRewardsAdded) {
                    for (const reward of changedQuests[questData.id].finishRewardsAdded[rewardType]) {
                        if (reward.locale_map) {
                            reward.locale = {};
                            for (const code in locales) {
                                const lang = locales[code];
                                if (!reward.locale[code]) reward.locale[code] = {};
                                for (const key in reward.locale_map) {
                                    reward.locale[code][key] = lang.interface[reward.locale_map[key]];
                                }
                            }
                        }
                        questData.finishRewards[rewardType].push(reward);
                    }
                }
            }
            if (changedQuests[questData.id] && changedQuests[questData.id].finishRewardsChanged) {
                for (const rewardType in changedQuests[questData.id].finishRewardsChanged) {
                    questData.finishRewards[rewardType] = changedQuests[questData.id].finishRewardsChanged[rewardType];
                }
            }
            let nameMatch = undefined;
            for (const tdQuest of tdQuests) {
                if (questData.id == tdQuest.gameId) {
                    questData.tarkovDataId = tdQuest.id;
                    tdMatched.push(tdQuest.id);
                    break;
                }
                if (questData.name == tdQuest.title) {
                    nameMatch = tdQuest.id;
                    //logger.warn(`Found possible TarkovData name match for ${questData.name} ${questData.id}`)
                }
            }
            if (typeof nameMatch !== 'undefined') {
                questData.tarkovDataId = nameMatch;
                tdMatched.push(nameMatch);
            }
            if (typeof questData.tarkovDataId === 'undefined') {
                questData.tarkovDataId = null;
                logger.warn(`Could not find TarkovData quest id for ${questData.name} ${questData.id}`);
            } else {
                mergeTdQuest(questData);
            }
            if (factionMap[questData.id]) questData.factionName = factionMap[questData.id];
            if (missingQuests[questData.id]) delete missingQuests[questData.id];

            if (changedQuests[questData.id]?.propertiesChanged) {
                for (const key of Object.keys(changedQuests[questData.id].propertiesChanged)) {
                    questData[key] = changedQuests[questData.id].propertiesChanged[key];
                }
            }
            quests.data.push(questData);
        }
        
        for (const questId in missingQuests) {
            const quest = missingQuests[questId];
            for (const q of quests.data) {
                if (q.id === quest.id) {
                    continue;
                }
            }
            logger.warn(`Adding missing quest ${quest.name} ${quest.id}...`);
            quest.locale = {};
            for (const code in locales) {
                const lang = locales[code];
                quest.locale[code] = {
                    name: lang.quest[questId]?.name || locales.en.quest[questId].name
                };
            }
            quest.wikiLink = `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(en.quest[questId].name.replaceAll(' ', '_'))}`;
            for (const obj of quest.objectives) {
                obj.locale = {};
                for (const code in locales) {
                    const lang = locales[code];
                    obj.locale[code] = {
                        description: lang.quest[questId]?.conditions[obj.id] || locales.en.quest[questId].conditions[obj.id]
                    };
                }
                if (obj.type.endsWith('QuestItem')) {
                    obj.questItem.locale = {};
                    for (const code in locales) {
                        const lang = locales[code];
                        obj.questItem.locale[code] = {
                            name: lang.templates[obj.questItem.id].Name
                        };
                    }
                }
            }
            for (const tdQuest of tdQuests) {
                if (quest.id == tdQuest.gameId || quest.name === tdQuest.title) {
                    quest.tarkovDataId = tdQuest.id;
                    tdMatched.push(tdQuest.id);
                    mergeTdQuest(quest, tdQuest);
                    break;
                }
            }
            quests.data.push(quest);
        }
        for (const tdQuest of tdQuests) {
            try {
                if (tdQuest.gameId && removedQuests[tdQuest.gameId]) continue;
                if (!tdMatched.includes(tdQuest.id)) {
                    logger.warn(`Adding TarkovData quest ${tdQuest.title} ${tdQuest.id}...`);
                    if (!tdTraders) {
                        logger.log('Retrieving TarkovTracker traders.json...');
                        tdTraders = (await got('https://github.com/TarkovTracker/tarkovdata/raw/master/traders.json', {
                            responseType: 'json',
                        })).body;
                        logger.log('Retrieving TarkovTracker maps.json...');
                        tdMaps = (await got('https://github.com/TarkovTracker/tarkovdata/raw/master/maps.json', {
                            responseType: 'json',
                        })).body;
                    }
                    quests.data.push(formatTdQuest(tdQuest));
                }
            } catch (error) {
                logger.error('Error processing missing TarkovData quests');
                logger.error(error);
            }
        }
        logger.log('Finished processing TarkovData quests');

        // add start, success, and fail message ids

        for (const quest of quests.data) {
            quest.startMessageId = locales.en.quest[quest.id]?.startedMessageText;
            quest.successMessageId = locales.en.quest[quest.id]?.successMessageText;
            quest.failMessageId = locales.en.quest[quest.id]?.failMessageText;
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
        for (const questId in en.quest) {
            let found = false;
            for (const quest of quests.data) {
                if (questId === quest.id) {
                    found = true;
                    break;
                };
            }
            if (found || !en.quest[questId].name || ignoreQuests.includes(questId)) continue;
            if (removedQuests[questId]) {
                logger.warn(`Quest ${en.quest[questId].name} ${questId} has been removed`);
                continue;
            }
            logger.warn(`No quest data found for ${en.quest[questId].name} ${questId}`);
        }

        quests.legacy = await legacyQuests(tdQuests, logger);

        logger.log('Writing quests.json...');
        //fs.writeFileSync(path.join(__dirname, '..', 'cache', 'tasks.json'), JSON.stringify(quests.data, null, 4));

        const response = await cloudflare.put('quest_data', JSON.stringify(quests)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of quest_data');
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
    await jobComplete();
    logger.end();
    logger = en = locales = items = presets = tdQuests = tdTraders = tdMaps = false;
}