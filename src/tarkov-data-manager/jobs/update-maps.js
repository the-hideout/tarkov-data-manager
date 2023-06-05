const fs = require('fs');

const remoteData = require('../modules/remote-data');
const tarkovData = require('../modules/tarkov-data');
const normalizeName = require('../modules/normalize-name');
//const mapQueueTimes = require('../modules/map-queue-times');
const DataJob = require('../modules/data-job');
const s3 = require('../modules/upload-s3');

class UpdateMapsJob extends DataJob {
    constructor() {
        super('update-maps');
        this.kvName = 'map_data';
    }

    run = async () => {
        this.logger.log('Getting maps data...');
        [this.items, this.presets] = await Promise.all([
            remoteData.get(),
            this.jobManager.jobOutput('update-presets', this, true),
        ]);
        this.mapRotationData = JSON.parse(fs.readFileSync('./data/map_coordinates.json'));
        this.bossLoadouts = {};
        this.processedBosses = {};
        const locations = await tarkovData.locations();
        this.s3Images = s3.getLocalBucketContents();
        this.kvData.Map = [];
        this.logger.log('Processing maps...');
        for (const id in locations.locations) {
            const map = locations.locations[id];
            if (id !== '59fc81d786f774390775787e' && (!map.Enabled || map.Locked)) {
                this.logger.log(`❌ ${this.locales.en[`${id} Name`] || ''} ${id}`);
                continue;
            }
            const mapData = {
                id: id,
                tarkovDataId: null,
                name: this.addTranslation(`${id} Name`),
                normalizedName: normalizeName(this.locales.en[`${id} Name`]),
                nameId: map.Id,
                description: this.locales.en[`${id} Description`],
                wiki: 'https://escapefromtarkov.fandom.com/wiki/'+this.locales.en[`${id} Name`].replace(/ /g, '_'),
                enemies: [],
                raidDuration: map.EscapeTimeLimit,
                players: map.MinPlayers+'-'+map.MaxPlayers,
                bosses: [],
                coordinateToCardinalRotation: 180,
                minPlayerLevel: map.RequiredPlayerLevelMin,
                maxPlayerLevel: map.RequiredPlayerLevelMax,
                accessKeys: map.AccessKeys,
                accessKeysMinPlayerLevel: map.MinPlayerLvlAccessKeys,
            };
            if (this.mapRotationData[id]) {
                mapData.coordinateToCardinalRotation = this.mapRotationData[id].rotation;
            }
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
                    //normalizedName: normalizeName(this.getEnemyName(spawn.BossName, this.locales.en)),
                    spawnChance: parseFloat(spawn.BossChance) / 100,
                    spawnLocations: [],
                    escorts: [],
                    supports: [],
                    spawnTime: spawn.Time,
                    spawnTimeRandom: spawn.RandomTimeSpawn,
                    spawnTrigger: null,
                };
                await this.getBossInfo(spawn.BossName);
                if (bossData.spawnChance === 0) {
                    continue;
                }
                const locationCount = {};
                const spawnKeys = spawn.BossZone.split(',');
                const locations = spawnKeys.map(zone => {
                    let locationName = zone.replace(/Zone_?/, '').replace(/Bot/, '');
                    if (!locationName) locationName = 'Anywhere';
                    if (typeof locationCount[locationName] === 'undefined') locationCount[locationName] = {key: zone, count: 0};
                    locationCount[locationName].count++;
                    return locationName;
                });
                for (const locationName in locationCount) {
                    bossData.spawnLocations.push({
                        name: locationName,
                        chance: Math.round((locationCount[locationName].count / locations.length) * 100) / 100,
                        spawnKey: locationCount[locationName].key,
                        name: this.addTranslation(locationCount[locationName].key, (lang, langCode) => {
                            if (lang[locationCount[locationName].key]) {
                                return lang[locationCount[locationName].key];
                            }
                            if (langCode !== 'en' && this.locales.en[locationCount[locationName].key]) {
                                return this.locales.en[locationCount[locationName].key];
                            }
                            this.logger.warn(`No translation found for spawn location ${locationCount[locationName].key}`);
                            return locationName;
                        }),
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
                        //normalizedName: normalizeName(this.getEnemyName(enemyKey, this.locales.en)),
                        amount: getChances(spawn.BossEscortAmount, 'count', true), 
                    });
                    await this.getBossInfo(spawn.BossEscortType);
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
                            //normalizedName: normalizeName(this.getEnemyName(enemyKey, this.locales.en)),
                            amount: getChances(support.BossEscortAmount, 'count', true), 
                        });
                        await this.getBossInfo(support.BossEscortType);
                    }
                }

                if (spawn.TriggerId) {
                    if (this.locales.en[spawn.TriggerId]) {
                        bossData.spawnTrigger = this.addTranslation(spawn.TriggerId);
                    } else if (spawn.TriggerId.includes('EXFIL')) {
                        bossData.spawnTrigger = this.addTranslation('ExfilActivation');
                    }
                }
                /*bossData.locale = getTranslations({
                    name: lang => {
                        return this.getEnemyName(bossData.name, lang);
                    }
                }, this.logger);
                for (const escort of bossData.escorts) {
                    escort.locale = getTranslations({
                        name: lang => {
                            return this.getEnemyName(escort.name, lang);
                        }
                    }, this.logger);
                }*/
                mapData.bosses.push(bossData);
            }
            mapData.enemies = this.addTranslation([...enemySet], (enemy, lang) => {
                return this.getEnemyName(enemy, lang);
            });
            mapData.name = this.addTranslation(`${id} Name`, (lang) => {
                if (id === '59fc81d786f774390775787e' && lang.factory4_night) {
                    return lang.factory4_night;
                }
                return lang[`${id} Name`];
            }),
            mapData.description = this.addTranslation(`${id} Description`),
            mapData.normalizedName = normalizeName(this.kvData.locale.en[mapData.name]);
            this.kvData.Map.push(mapData);
            this.logger.log(`✔️ ${this.kvData.locale.en[mapData.name]} ${id}`);
        }

        await Promise.allSettled(this.kvData.Map.map(mapData => {
            return tarkovData.mapLoot(mapData.nameId, true);
        })).then(results => {
            results.forEach(result => {
                if (result.status === 'fulfilled') {
                    return;
                }
                this.logger.error(`Error downloading map loot: ${result.reason}`);
            });
        });

        //const queueTimes = await mapQueueTimes(maps.data, this.logger);
        this.kvData.Map = this.kvData.Map.sort((a, b) => a.name.localeCompare(b.name)).map(map => {
            return {
                ...map,
                //queueTimes: queueTimes[map.id]
            };
        });
        this.logger.log(`Processed ${this.kvData.Map.length} maps`);

        this.kvData.MobInfo = this.processedBosses;
        this.logger.log(`Processed ${Object.keys(this.kvData.MobInfo).length} mobs`);
        for (const mob of Object.values(this.kvData.MobInfo)) {
            this.logger.log(`✔️ ${this.kvData.locale.en[mob.name]}`);
        }

        await this.cloudflarePut();
        return this.kvData;
    }

    isValidItem = (id) => {
        const item = this.items.get(id);
        if (!item) {
            return false;
        }
        if (item.types.includes('disabled')) {
            return false;
        }
        if (item.types.includes('quest')) {
            return false;
        }
        return true;
    }

    getEnemyName = (enemy, lang) => {
        if (enemyMap[enemy]) {
            if (lang[enemyMap[enemy]]) {
                return lang[enemyMap[enemy]];
            }
            return this.locales.en[enemyMap[enemy]];
        }
        if (lang[enemy]) {
            return lang[enemy];
        }
        if (enemy.includes('follower') && !enemy.includes('BigPipe') && !enemy.includes('BirdEye')) {
            const nameParts = [];
            const guardTypePattern = /Assault|Security|Scout/;
            const bossKey = enemy.replace('follower', 'boss').replace(guardTypePattern, '');
            nameParts.push(this.getEnemyName(bossKey, lang));
            nameParts.push(this.getEnemyName('guard', lang));
            const guardTypeMatch = enemy.match(guardTypePattern);
            if (guardTypeMatch) {
                if (lang[`follower${guardTypeMatch[0]}`]) {
                    nameParts.push(`(${lang[`follower${guardTypeMatch[0]}`]})`);
                } else {
                    nameParts.push(`(${guardTypeMatch[0]})`);
                }
            }
            return nameParts.join(' ')
        }
        if (this.locales.en[enemy]) {
            return this.locales.en[enemy];
        }
        return enemy.replace('boss', '');
    }

    matchEquipmentItemToPreset = (equipmentItem) => {
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
        for (const preset of Object.values(this.presets)) {
            if (preset.baseId !== baseItemId) {
                continue;
            }
            const presetParts = preset.containsItems.filter(ci => ci.item.id !== preset.baseId).filter(ci => !this.items.get(ci.item.id).types.includes('ammo'));
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
    }

    getModsForItem = (id, modList, mods = []) => {
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
                                name: this.items.get(modId).name,
                            },
                            possibleMods: this.getModsForItem(modId, modList)
                        });
                    }
                    return allMods;
                }, []),
            };
            mods.push(slotMods);*/
            for (const modId of modList[id][slot]) {
                mods.push({
                    item: modId,
                    item_name: this.items.get(modId).name,
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
                this.getModsForItem(modId, modList, mods);
            }
        }
        //return mods;
    }

    getBossInfo = async (bossKey) => {
        if (this.processedBosses[bossKey]) {
            return this.processedBosses[bossKey];
        }
        if (!this.bossLoadouts[bossKey]) {
            this.bossLoadouts[bossKey] = await tarkovData.botInfo(bossKey, true).catch(error => {
                this.logger.error(`Error getting ${bossKey} boss info: ${error.message}`);
                return tarkovData.botInfo(bossKey, false).catch(err => {
                    this.logger.error`Error reading local ${bossKey} boss info: ${err.messsage}`;
                    return false;
                });
            });
            /*if (!this.bossLoadouts[bossKey]) {
                return undefined;
            }*/
        }
        const bossData = this.bossLoadouts[bossKey];
        const bossInfo = {
            id: bossKey,
            name: this.addTranslation(bossKey, (lang) => {
                return this.getEnemyName(bossKey, lang);
            }),
            normalizedName: normalizeName(this.getEnemyName(bossKey, this.locales.en)),
            imagePortraitLink: `https://${process.env.S3_BUCKET}/unknown-mob-portrait.webp`,
            imagePosterLink: `https://${process.env.S3_BUCKET}/unknown-mob-poster.webp`,
            equipment: [],
            items: [],
        };
        const extensions = [
            'webp',
            'png',
            'jpg',
        ];
        const imageSizes = ['Portrait', 'Poster'];
        for (const imageSize of imageSizes) {
            for (const ext of extensions) {
                const fileName = `${bossInfo.normalizedName}-${imageSize.toLowerCase()}.${ext}`;
                if (this.s3Images.includes(fileName)) {
                    bossInfo[`image${imageSize}Link`] = `https://${process.env.S3_BUCKET}/${fileName}`;
                    break;
                }
            }
        }
        if (!bossData) {
            this.processedBosses[bossKey] = bossInfo;
            return bossInfo;
        }
        bossInfo.health = Object.keys(bossData.health.BodyParts[0]).map(bodyPart => {
            return {
                id: bodyPart,
                bodyPart: this.addTranslation(bodyPart),
                max: bossData.health.BodyParts[0][bodyPart].max,
            };
        });
        for (const slotName in bossData.inventory.equipment) {
            const totalWeight = Object.keys(bossData.inventory.equipment[slotName]).reduce((total, id) => {
                if (this.isValidItem(id)) {
                    total += bossData.inventory.equipment[slotName][id];
                }
                return total;
            }, 0);
            for (const id in bossData.inventory.equipment[slotName]) {
                if (!this.isValidItem(id)) {
                    continue;
                }
                const equipmentItem = {
                    item: id,
                    item_name: this.items.get(id).name,
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
                this.getModsForItem(id, bossData.inventory.mods, equipmentItem.contains);
                const preset = this.matchEquipmentItemToPreset(equipmentItem);
                if (preset) {
                    equipmentItem.item = preset.id;
                    equipmentItem.item_name = preset.locale.en.name;
                    //add base item to preset
                    equipmentItem.contains.unshift({
                        item: id,
                        item_name: this.items.get(id).name,
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
                if (!this.isValidItem(id)) {
                    continue;
                }
                bossInfo.items.push({
                    id: id,
                    name: this.items.get(id).name,
                });
            }
        }
        this.processedBosses[bossKey] = bossInfo;
        return bossInfo;
    }
}

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

module.exports = UpdateMapsJob;
