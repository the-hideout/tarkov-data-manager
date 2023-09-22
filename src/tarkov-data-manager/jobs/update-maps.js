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
        [this.items, this.presets, this.botInfo, this.mapDetails] = await Promise.all([
            remoteData.get(),
            this.jobManager.jobOutput('update-presets', this, true),
            tarkovData.botsInfo(false),
            tarkovData.mapDetails(),
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
            this.logger.log(`✔️ ${this.locales.en[`${id} Name`]} ${id}`);
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
                spawns: map.SpawnPointParams.map(spawn => {
                    if (spawn.Sides.includes('Usec') && spawn.Sides.includes('Bear')) {
                        spawn.Sides = spawn.Sides.filter(side => !['Usec', 'Bear', 'Pmc'].includes(side));
                        spawn.Sides.push('Pmc');
                    }
                    spawn.Categories = spawn.Categories.filter(cat => !['Coop', 'Opposite', 'Group'].includes(cat));
                    if (spawn.Categories.length === 0) {
                        return false;
                    }
                    return {
                        position: spawn.Position,
                        sides: spawn.Sides.map(side => {
                            if (side === 'Savage') {
                                return 'scav';
                            }
                            return side.toLowerCase();
                        }),
                        categories: spawn.Categories.map(cat => cat.toLowerCase()),
                        zoneName: spawn.BotZoneName || spawn.Id,
                    };
                }).filter(Boolean),
                extracts: this.mapDetails[id].extracts.map(extract => {
                    return {
                        id: extract.settings.Name,
                        name: this.addTranslation(extract.settings.Name),
                        faction: exfilFactions[extract.exfilType],
                        ...extract.location,
                    };
                }),
                locks: this.mapDetails[id].locks.map(lock => {
                    const keyItem = this.items.get(lock.key);
                    if (!keyItem || keyItem.types.includes('disabled')) {
                        this.logger.warn(`Skipping lock for key ${lock.key}`)
                        return false;
                    }
                    return {
                        lockType: lock.lockType,
                        key: lock.key,
                        ...lock.location,
                    }
                }).filter(Boolean),
                hazards: this.mapDetails[id].hazards.map(hazard => {
                    if (!hazardMap[hazard.hazardType]) {
                        this.logger.warn(`Unknown hazard type: ${hazard.hazardType}`);
                    }
                    let hazardType = hazardMap[hazard.hazardType]?.id || hazard.hazardType;
                    let hazardName = hazardMap[hazard.hazardType]?.name || hazard.hazardType;
                    return {
                        hazardType: hazardType,
                        name: this.addTranslation(hazardName),
                        ...hazard.location,
                    };
                }),
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
                const newBoss = !enemySet.has(spawn.BossName);
                enemySet.add(spawn.BossName);
                const bossData = {
                    id: spawn.BossName,
                    spawnChance: parseFloat(spawn.BossChance) / 100,
                    spawnLocations: [],
                    escorts: [],
                    supports: [],
                    spawnTime: spawn.Time,
                    spawnTimeRandom: spawn.RandomTimeSpawn,
                    spawnTrigger: null,
                };
                const bossInfo = await this.getBossInfo(spawn.BossName);
                if (bossData.spawnChance === 0) {
                    continue;
                }
                if (newBoss) {
                    this.logger.log(` - ${bossInfo.name}`);
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
                for (const key of spawnKeys) {
                    if (!mapData.spawns.some(spawn => spawn.categories.includes('boss') && spawn.zoneName === key)) {
                        mapData.spawns.forEach(spawn => {
                            if (spawn.zoneName !== key) {
                                return;
                            }
                            spawn.categories.push('boss');
                        });
                    }
                }
                for (const locationName in locationCount) {
                    let spawns = mapData.spawns.filter(spawn => spawn.zoneName === locationCount[locationName].key && (spawn.categories.includes('boss') || spawn.categories.includes('all')));
                    if (spawns.length === 0 && locationCount[locationName].key !== 'BotZone') {
                        const cleanKey = locationCount[locationName].key.replace('Zone', '');
                        const foundSpawn = mapData.spawns.find(spawn => spawn.zoneName?.startsWith(cleanKey));
                        if (foundSpawn) {
                            foundSpawn.zoneName = locationCount[locationName].key;
                            if (!foundSpawn.categories.includes('boss')) {
                                foundSpawn.categories.push('boss');
                            }
                            spawns.push(foundSpawn);
                        }
                    }
                    bossData.spawnLocations.push({
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
                        chance: Math.round((locationCount[locationName].count / locations.length) * 100) / 100,
                        spawnKey: locationCount[locationName].key,
                        positions: spawns.map(spawn => spawn.position),
                    });
                }
                if (spawn.BossEscortAmount !== '0') {
                    let enemyData = await this.getBossInfo(spawn.BossEscortType);
                    const newMob = !enemySet.has(enemyData.id);
                    enemySet.add(enemyData.id);
                    bossData.escorts.push({
                        id: enemyData.id,
                        amount: getChances(spawn.BossEscortAmount, 'count', true), 
                    });
                    if (newMob) {
                        this.logger.log(` - ${enemyData.name}`);
                    }
                }
                if (spawn.Supports) {
                    for (const support of spawn.Supports) {
                        if (support.BossEscortAmount === '0') continue;
                        let enemyData = await this.getBossInfo(support.BossEscortType);
                        const newMob = !enemySet.has(enemyData.id);
                        enemySet.add(enemyData.id);
                        bossData.escorts.push({
                            id: enemyData.id,
                            amount: getChances(support.BossEscortAmount, 'count', true), 
                        });
                        if (newMob) {
                            this.logger.log(` - ${enemyData.name}`);
                        }
                    }
                }

                if (spawn.TriggerId) {
                    if (this.locales.en[spawn.TriggerId]) {
                        bossData.spawnTrigger = this.addTranslation(spawn.TriggerId);
                    } else if (spawn.TriggerId.includes('EXFIL')) {
                        bossData.spawnTrigger = this.addTranslation('ExfilActivation');
                    }
                }
                mapData.bosses.push(bossData);
            }
            mapData.enemies = this.addTranslation([...enemySet], (enemy, lang, langCode) => {
                return this.getMobName(enemy, lang, langCode);
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
        }

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
            //this.logger.log(`✔️ ${this.kvData.locale.en[mob.name]}`);
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
        bossKey = this.getMobKey(bossKey);
        if (this.processedBosses[bossKey]) {
            return this.processedBosses[bossKey];
        }
        const bossInfo = {
            id: bossKey,
            name: this.addTranslation(bossKey, (lang, langCode) => {
                return this.getMobName(bossKey, lang, langCode);
            }),
            normalizedName: normalizeName(this.getMobName(bossKey, this.locales.en, 'en')),
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
        const bossExtraData = this.botInfo[bossKey.toLowerCase()];
        if (!bossExtraData) {
            this.processedBosses[bossKey] = bossInfo;
            return bossInfo;
        }
        bossInfo.health = Object.keys(bossExtraData.health.BodyParts[0]).map(bodyPart => {
            return {
                id: bodyPart,
                bodyPart: this.addTranslation(`QuestCondition/Elimination/Kill/BodyPart/${bodyPart}`),
                max: bossExtraData.health.BodyParts[0][bodyPart].max,
            };
        });
        for (const slotName in bossExtraData.inventory.equipment) {
            const totalWeight = Object.keys(bossExtraData.inventory.equipment[slotName]).reduce((total, id) => {
                if (this.isValidItem(id)) {
                    total += bossExtraData.inventory.equipment[slotName][id];
                }
                return total;
            }, 0);
            for (const id in bossExtraData.inventory.equipment[slotName]) {
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
                            value: Math.round((bossExtraData.inventory.equipment[slotName][id] / totalWeight) * 100) / 100,
                        }
                    ]
                };
                this.getModsForItem(id, bossExtraData.inventory.mods, equipmentItem.contains);
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
        for (const slotName in bossExtraData.inventory.items) {
            for (const id of bossExtraData.inventory.items[slotName]) {
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

const exfilFactions = {
    SharedExfiltrationPoint: 'shared',
    ExfiltrationPoint: 'pmc',
    ScavExfiltrationPoint: 'scav',
};

const hazardMap = {
    SniperFiringZone: {
        id: 'sniper',
        name: 'ScavRole/Marksman',
    },
    Minefield: {
        id: 'minefield',
        name: 'DamageType_Landmine',
    }
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
