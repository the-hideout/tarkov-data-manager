const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovData = require('../modules/tarkov-data');
const normalizeName = require('../modules/normalize-name');
//const mapQueueTimes = require('../modules/map-queue-times');
const { setLocales, getTranslations } = require('../modules/get-translation');
const jobOutput = require('../modules/job-output');

const mapNames = {
    '59fc81d786f774390775787e': 'Night Factory',
    '55f2d3fd4bdc2d5f408b4567': 'Factory',
    '5704e4dad2720bb55b8b4567': 'Lighthouse',
    '56f40101d2720b2a4d8b45d6': 'Customs',
    '5704e5fad2720bc05b8b4567': 'Reserve',
    '5714dbc024597771384a510d': 'Interchange',
    '5704e554d2720bac5b8b456e': 'Shoreline',
    '5704e3c2d2720bac5b8b4567': 'Woods',
    '5b0fc42d86f7744a585f9105': 'The Lab'
};

const idMap = {
    '55f2d3fd4bdc2d5f408b4567': 0,
    '59fc81d786f774390775787e': 0,
    '56f40101d2720b2a4d8b45d6': 1,
    '5704e3c2d2720bac5b8b4567': 2,
    '5704e554d2720bac5b8b456e': 3,
    '5714dbc024597771384a510d': 4,
    '5b0fc42d86f7744a585f9105': 5,
    '5704e5fad2720bc05b8b4567': 6,
    '5704e4dad2720bb55b8b4567': 7,
};

const enemyMap = {
    'bossGluhar': 'QuestCondition/Elimination/Kill/BotRole/bossGluhar',
    'bossKilla': 'QuestCondition/Elimination/Kill/BotRole/bossKilla',
    'pmcBot': 'ScavRole/PmcBot',
    'bossBully': 'QuestCondition/Elimination/Kill/BotRole/bossBully',
    'exUsec': 'ScavRole/ExUsec',
    'bossSanitar': 'QuestCondition/Elimination/Kill/BotRole/bossSanitar',
    'scavs': 'QuestCondition/Elimination/Kill/Target/Savage',
    'sniper': 'ScavRole/Marksman',
    'sectantPriest': 'QuestCondition/Elimination/Kill/BotRole/sectantPriest',
    'sectantWarrior': 'QuestCondition/Elimination/Kill/BotRole/cursedAssault',
    'bossKojaniy': 'QuestCondition/Elimination/Kill/BotRole/bossKojaniy',
    'bossTagilla': 'QuestCondition/Elimination/Kill/BotRole/bossTagilla',
    'bossZryachiy': '63626d904aa74b8fe30ab426 ShortName',
    'guard': 'ScavRole/Follower',
};

const manualNames = {
    'bossKnight': 'Death Knight',
    'followerBigPipe': 'Big Pipe',
    'followerBirdEye': 'Birdeye'
};

const triggers = {
    '5704e5fad2720bc05b8b4567' : {
        'autoId_00000_D2_LEVER': 'D-2 Power Switch',
        'autoId_00632_EXFIL': 'Bunker Hermetic Door Power Switch'
    }
};

let logger;
let locales;
let items;
let presets;
let bossLoadouts = {};
let processedBosses = {};

const getEnemyName = (enemy, lang) => {
    if (enemyMap[enemy]) {
        if (lang[enemyMap[enemy]]) {
            return lang[enemyMap[enemy]];
        }
        return locales.en[enemyMap[enemy]];
    }
    if (manualNames[enemy]) {
        return manualNames[enemy];
    }
    if (enemy.includes('follower')) {
        const nameParts = [];
        const guardTypePattern = /Assault|Security|Scout/;
        const bossKey = enemy.replace('follower', 'boss').replace(guardTypePattern, '');
        nameParts.push(getEnemyName(bossKey, lang));
        nameParts.push(getEnemyName('guard', lang));
        const guardTypeMatch = enemy.match(guardTypePattern);
        if (guardTypeMatch) {
            nameParts.push(guardTypeMatch[0]);
        }
        return nameParts.join(' ')
    }
    return enemy.replace('boss', '');
};

const getChances = (input, nameLabel = 'name', labelInt = false) => {
    const optionCount = {};
    const options = input.split(',').map(option => {
        if (labelInt) option = parseInt(option);
        if (typeof optionCount[option] === 'undefined') optionCount[option] = 0;
        optionCount[option]++;
        return option;
    });
    const chances = [];
    for (const option in optionCount) {
        const chance = {
            chance: Math.round((optionCount[option] / options.length) * 100) / 100
        };
        chance[nameLabel] = labelInt ? parseInt(option) : option;
        chances.push(chance);
    }
    return chances;
}

const matchEquipmentItemToPreset = (equipmentItem) => {
    const baseItemId = equipmentItem.item;
    const parts = equipmentItem.contains;
    const multipleConfigurations = parts.some((contained, containedIndex) => {
        const containedParent = contained.attributes.find(att => att.name === 'parentItemId').value;
        const containedSlot = contained.attributes.find(att => att.name === 'slotNameId').value;
        for (let compareIndex = 0; compareIndex < parts.length; compareIndex++) {
            const comparePart = parts[compareIndex];
            if (compareIndex === containedIndex) {
                continue;
            }
            const compareParent = comparePart.attributes.find(att => att.name === 'parentItemId').value;
            const compareSlot = comparePart.attributes.find(att => att.name === 'slotNameId').value;
            if (containedParent === compareParent && containedSlot === compareSlot) {
                // there are multiple parts potentially occupying the same slot, so can't be a preset
                return false;
            }
        }
    });
    if (multipleConfigurations) {
        return false;
    }
    const containedParts = parts.filter(p => {
        return !p.attributes.some(a => a.value === 'cartridges');
    });
    for (const preset of Object.values(presets)) {
        if (preset.baseId !== baseItemId) {
            continue;
        }
        const presetParts = preset.containsItems.filter(ci => ci.item.id !== preset.baseId).filter(ci => !items[ci.item.id].types.includes('ammo'));
        if (presetParts.length !== containedParts.length) {
            continue;
        }
        const partIsMissing = presetParts.some(contained => {
            return !containedParts.some(part => contained.item.id === part.item);
        });
        if (partIsMissing) {
            continue;
        }
        return preset;
    }
    return false;
};

const getModsForItem = (id, modList, mods = []) => {
    if (!modList[id]) {
        return mods;
    }
    for (const slot in modList[id]) {
        /*const slotMods = {
            slot: slot,
            possibleMods: modList[id][slot].reduce((allMods, modId) => {
                if (!allMods.some(testMod => testMod.id === modId)) {
                    allMods.push({
                        item: {
                            id: modId,
                            name: items[modId].locale.en.name,
                        },
                        possibleMods: getModsForItem(modId, modList)
                    });
                }
                return allMods;
            }, []),
        };
        mods.push(slotMods);*/
        for (const modId of modList[id][slot]) {
            mods.push({
                item: modId,
                item_name: items[modId].locale.en.name,
                count: 1,
                attributes: [
                    {
                        name: 'parentItemId',
                        value: id,
                    },
                    {
                        name: 'slotNameId',
                        value: slot,
                    }
                ],
            });
            getModsForItem(modId, modList, mods);
        }
    }
    //return mods;
};

const getBossInfo = async (bossKey) => {
    if (processedBosses[bossKey]) {
        return processedBosses[bossKey];
    }
    if (!bossLoadouts[bossKey]) {
        bossLoadouts[bossKey] = await tarkovData.botInfo(bossKey, true).catch(error => {
            logger.error(`Error getting ${bossKey} boss info: ${error.messsage}`);
            //return false;
        });
        /*if (!bossLoadouts[bossKey]) {
            return undefined;
        }*/
    }
    const bossData = bossLoadouts[bossKey];
    const bossInfo = {
        id: bossKey,
        normalizedName: normalizeName(getEnemyName(bossKey, locales.en)),
        equipment: [],
        items: [],
        locale: getTranslations({
            name: lang => {
                return getEnemyName(bossKey, lang);
            }
        }, logger),
    };
    if (!bossData) {
        processedBosses[bossKey] = bossInfo;
        return bossInfo;
    }
    bossInfo.health = Object.keys(bossData.health.BodyParts[0]).map(bodyPart => {
        return {
            id: bodyPart,
            max: bossData.health.BodyParts[0][bodyPart].max,
            locale: getTranslations({bodyPart: bodyPart}, logger),
        };
    });
    for (const slotName in bossData.inventory.equipment) {
        const totalWeight = Object.keys(bossData.inventory.equipment[slotName]).reduce((total, id) => {
            if (items[id]) {
                total += bossData.inventory.equipment[slotName][id];
            }
            return total;
        }, 0);
        for (const id in bossData.inventory.equipment[slotName]) {
            if (!items[id]) {
                continue;
            }
            equipmentItem = {
                item: id,
                item_name: items[id].locale.en.name,
                contains: [],
                count: 1,
                attributes: [
                    {
                        name: 'slot',
                        value: slotName,
                    },
                    {
                        name: 'weightedChance',
                        value: Math.round((bossData.inventory.equipment[slotName][id] / totalWeight) * 100) / 100,
                    }
                ]
            };
            getModsForItem(id, bossData.inventory.mods, equipmentItem.contains);
            const preset = matchEquipmentItemToPreset(equipmentItem);
            if (preset) {
                equipmentItem.item = preset.id;
                equipmentItem.item_name = preset.locale.en.name;
                //add base item to preset
                equipmentItem.contains.unshift({
                    item: id,
                    item_name: items[id].locale.en.name,
                    count: 1,
                    attributes: [],
                });
            }
            bossInfo.equipment.push(equipmentItem);
        }
    }
    bossInfo.items = [];
    for (const slotName in bossData.inventory.items) {
        for (const id of bossData.inventory.items[slotName]) {
            if (bossInfo.items.some(item => item.id === id)) {
                continue;
            }
            if (!items[id]) {
                continue;
            }
            bossInfo.items.push({
                id: id,
                name: items[id].name,
            });
        }
    }
    processedBosses[bossKey] = bossInfo;
    return bossInfo;
};

module.exports = async function() {
    logger = new JobLogger('update-maps');
    bossLoadouts = {}
    processedBosses = {};
    try {
        logger.log('Getting maps data...');
        locales = await tarkovData.locales();
        items = await jobOutput('update-item-cache', './dumps/item_data.json', logger);
        presets = await jobOutput('update-presets', './cache/presets.json', logger);
        setLocales(locales);
        const locations = await tarkovData.locations();
        const maps = {
            updated: new Date(),
            data: [],
        };
        logger.log('Processing maps...');
        for (const id in locations.locations) {
            const map = locations.locations[id];
            if (id !== '59fc81d786f774390775787e' && (!map.Enabled || map.Locked)) {
                logger.log(`❌ ${locales.en[`${id} Name`] || ''} ${id}`);
                continue;
            }
            const mapData = {
                id: id,
                tarkovDataId: null,
                name: locales.en[`${id} Name`],
                normalizedName: normalizeName(locales.en[`${id} Name`]),
                nameId: map.Id,
                description: locales.en[`${id} Description`],
                wiki: 'https://escapefromtarkov.fandom.com/wiki/'+locales.en[`${id} Name`].replace(/ /g, '_'),
                enemies: [],
                raidDuration: map.EscapeTimeLimit,
                players: map.MinPlayers+'-'+map.MaxPlayers,
                bosses: [],
                locale: {}
            };
            if (typeof idMap[id] !== 'undefined') mapData.tarkovDataId = idMap[id];
            const enemySet = new Set();
            for (const wave of map.waves) {
                if (wave.WildSpawnType === 'assault') {
                    enemySet.add('scavs');
                } else if (wave.WildSpawnType === 'marksman') {
                    enemySet.add('sniper');
                }
            }
            for (const spawn of map.BossLocationSpawn) {
                enemySet.add(spawn.BossName);
                const bossData = {
                    id: spawn.BossName,
                    //name: spawn.BossName,
                    //normalizedName: normalizeName(getEnemyName(spawn.BossName, locales.en)),
                    spawnChance: parseInt(spawn.BossChance) / 100,
                    spawnLocations: [],
                    escorts: [],
                    supports: [],
                    spawnTime: spawn.Time,
                    spawnTimeRandom: spawn.RandomTimeSpawn,
                    spawnTrigger: null,
                    locale: {}
                };
                await getBossInfo(spawn.BossName);
                if (bossData.spawnChance === 0) {
                    continue;
                }
                const locationCount = {};
                const locations = spawn.BossZone.split(',').map(zone => {
                    let locationName = zone.replace(/Zone_?/, '').replace(/Bot/, '');
                    if (!locationName) locationName = 'Anywhere';
                    if (typeof locationCount[locationName] === 'undefined') locationCount[locationName] = 0;
                    locationCount[locationName]++;
                    return locationName;
                });
                for (const locationName in locationCount) {
                    bossData.spawnLocations.push({
                        name: locationName,
                        chance: Math.round((locationCount[locationName] / locations.length) * 100) / 100
                    });
                }
                if (spawn.BossEscortAmount !== '0') {
                    let enemyKey = spawn.BossEscortType;
                    /*if (!enemyMap[spawn.BossEscortType] && !manualNames[spawn.BossEscortType]) {
                        enemyKey = 'guard';
                    }*/
                    enemySet.add(enemyKey);
                    bossData.escorts.push({
                        id: spawn.BossEscortType,
                        //name: enemyKey,
                        //normalizedName: normalizeName(getEnemyName(enemyKey, locales.en)),
                        amount: getChances(spawn.BossEscortAmount, 'count', true), 
                        locale: {}
                    });
                    await getBossInfo(spawn.BossEscortType);
                }
                if (spawn.Supports) {
                    for (const support of spawn.Supports) {
                        if (support.BossEscortAmount === '0') continue;
                        let enemyKey = support.BossEscortType;
                        /*if (!enemyMap[enemyKey] && !manualNames[enemyKey]) {
                            enemyKey = 'guard';
                        }*/
                        enemySet.add(enemyKey);
                        bossData.escorts.push({
                            id: support.BossEscortType,
                            //name: enemyKey,
                            //normalizedName: normalizeName(getEnemyName(enemyKey, locales.en)),
                            amount: getChances(support.BossEscortAmount, 'count', true), 
                            locale: {}
                        });
                        await getBossInfo(support.BossEscortType);
                    }
                }

                if (spawn.TriggerId && triggers[id]) {
                    if (triggers[id][spawn.TriggerId]) {
                        bossData.spawnTrigger = triggers[id][spawn.TriggerId];
                    } else if (spawn.TriggerId.includes('EXFIL')) {
                        bossData.spawnTrigger = 'Exfil Activation';
                    }
                }
                /*bossData.locale = getTranslations({
                    name: lang => {
                        return getEnemyName(bossData.name, lang);
                    }
                }, logger);
                for (const escort of bossData.escorts) {
                    escort.locale = getTranslations({
                        name: lang => {
                            return getEnemyName(escort.name, lang);
                        }
                    }, logger);
                }*/
                mapData.bosses.push(bossData);
            }
            mapData.enemies = [...enemySet];
            mapData.locale = getTranslations({
                name: lang => {
                    if (id === '59fc81d786f774390775787e' && lang.factory4_night) {
                        return lang.factory4_night;
                    }
                    return lang[`${id} Name`];
                },
                description: `${id} Description`,
                enemies: lang => {
                    const enemies = new Set(mapData.enemies.map(enemy => {
                        return getEnemyName(enemy, lang);
                    }));
                    return [...enemies];
                }
            }, logger);
            mapData.name = mapData.locale.en.name;
            mapData.normalizedName = normalizeName(mapData.name);
            maps.data.push(mapData);
            logger.log(`✔️ ${mapData.name} ${id}`);
        }

        //const queueTimes = await mapQueueTimes(maps.data, logger);
        maps.data = maps.data.sort((a, b) => a.name.localeCompare(b.name)).map(map => {
            return {
                ...map,
                //queueTimes: queueTimes[map.id]
            };
        });
        logger.log(`Processed ${maps.data.length} maps`);

        maps.mobs = processedBosses;
        logger.log(`Processed ${Object.keys(maps.mobs).length} mobs`);
        for (const mob of Object.values(maps.mobs)) {
            logger.log(`✔️ ${mob.locale.en.name}`);
        }

        const response = await cloudflare.put('map_data', JSON.stringify(maps)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of map_data');
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
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
    //await jobComplete();
};