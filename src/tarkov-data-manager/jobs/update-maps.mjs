import fs from 'node:fs';
import crypto from 'node:crypto';

import DataJob from '../modules/data-job.mjs';
import remoteData from '../modules/remote-data.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
//import mapQueueTimes from '../modules/map-queue-times';
import s3 from '../modules/upload-s3.mjs';

class UpdateMapsJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-maps', loadLocales: true});
        this.kvName = 'map_data';
    }

    run = async () => {
        this.logger.log('Getting maps data...');
        [
            this.items,
            this.presets,
            this.botInfo,
            this.mapDetails,
            this.eftItems,
            this.goonReports,
        ] = await Promise.all([
            remoteData.get(),
            this.jobManager.jobOutput('update-presets', this, 'regular', true),
            tarkovData.botsInfo(),
            tarkovData.mapDetails(),
            tarkovData.items(),
            this.query('SELECT * FROM goon_reports WHERE timestamp >= now() - INTERVAL 1 DAY'),
        ]);
        this.mapRotationData = JSON.parse(fs.readFileSync('./data/map_coordinates.json'));
        this.bossLoadouts = {};
        this.processedBosses = {};
        this.lootContainers = {};
        this.stationaryWeapons = {};
        this.s3Images = s3.getLocalBucketContents();
        this.kvData = {};
        for (const gameMode of this.gameModes) {
            this.kvData[gameMode.name] = {
                Map: [],
            };
            const locations = await tarkovData.locations({gameMode: gameMode.name});
            this.logger.log(`Processing ${gameMode.name} maps...`);
            for (const id in locations.locations) {
                const map = locations.locations[id];
                if (id !== '59fc81d786f774390775787e' && (!map.Enabled || map.Locked)) {
                    this.logger.log(`❌ ${this.locales.en[`${id} Name`] || ''} ${id}`);
                    continue;
                }
                if (!this.locales.en[`${id} Name`]) {
                    this.logger.log(`❌ Map ${map.Id} ${id} has no translation`);
                    continue;
                }
                const mapData = {
                    id: id,
                    tarkovDataId: null,
                    name: this.addTranslation(`${id} Name`, (lang, langCode) => {
                        if (id === '59fc81d786f774390775787e' && lang.factory4_night) {
                            return lang.factory4_night;
                        }
                        if (id === '65b8d6f5cdde2479cb2a3125') {
                            if (lang['653e6760052c01c1c805532f Name']) {
                                return lang['653e6760052c01c1c805532f Name']+' 21+';
                            } else if (langCode !== 'en' && this.locales.en['653e6760052c01c1c805532f Name']) {
                                return this.locales.en['653e6760052c01c1c805532f Name']+' 21+';
                            }
                            return 'Ground Zero 21+';
                        }
                        return lang[`${id} Name`];
                    }),
                    normalizedName: '', // set below using the EN translation of name
                    nameId: map.Id,
                    description: this.addTranslation(`${id} Description`),
                    wiki: 'https://escapefromtarkov.fandom.com/wiki/'+this.locales.en[`${id} Name`].replace(/ /g, '_'),
                    enemies: [],
                    raidDuration: map.EscapeTimeLimit,
                    players: map.MinPlayers+'-'+map.MaxPlayers,
                    bosses: [],
                    coordinateToCardinalRotation: this.mapDetails[id].north_rotation || 180,
                    spawns: map.SpawnPointParams.map(spawn => {
                        if (spawn.Sides.includes('Usec') && spawn.Sides.includes('Bear')) {
                            spawn.Sides = spawn.Sides.filter(side => !['Usec', 'Bear', 'Pmc'].includes(side));
                            spawn.Sides.push('Pmc');
                        }
                        spawn.Categories = spawn.Categories.filter(cat => !['Coop', 'Opposite', 'Group'].includes(cat));
                        if (spawn.Categories.length === 0) {
                            return false;
                        }
                        const categories = spawn.Categories.map(cat => cat.toLowerCase());
                        if (map.waves.some(w => w.SpawnPoints.split(',').includes(spawn.BotZoneName) && w.WildSpawnType === 'marksman')) {
                            categories.push('sniper');
                        }
                        let zoneName = spawn.BotZoneName;
                        if (!zoneName) {
                            for (const zone of this.mapDetails[id].spawns) {
                                if (zone.spawnPoints.some(p => p.id === spawn.Id)) {
                                    zoneName = zone.name;
                                    break;
                                }
                            }
                            if (!zoneName) {
                                zoneName = spawn.Id;
                            }
                        }
                        return {
                            position: spawn.Position,
                            sides: spawn.Sides.map(side => {
                                if (side === 'Savage') {
                                    return 'scav';
                                }
                                return side.toLowerCase();
                            }),
                            categories: categories,
                            zoneName,
                        };
                    }).filter(Boolean),
                    extracts: this.mapDetails[id].extracts.map(extract => {
                        return {
                            id: this.getId(id, extract),
                            name: this.addTranslation(extract.settings.Name),
                            faction: exfilFactions[extract.exfilType],
                            switch: this.mapDetails[id].switches.reduce((found, current) => {
                                if (found) {
                                    return found;
                                }
                                if (!extract.exfilSwitchId) {
                                    return found;
                                }
                                if (current.id === extract.exfilSwitchId) {
                                    found = this.getId(id, current);
                                }
                                return found;
                            }, false),
                            switches: extract.exfilSwitchIds.map(switchId => {
                                const foundSwitch = this.mapDetails[id].switches.find(sw => sw.id === switchId && sw.hasCollider);
                                return foundSwitch ? this.getId(id, foundSwitch) : false;
                            }).filter(Boolean),
                            ...extract.location,
                        };
                    }),
                    transits: map.transits.map(transit => {
                        if (!transit.active) {
                            return false;
                        }
                        const locationData = this.mapDetails[id].transits.find(t => t.id === transit.id);
                        if (!locationData) {
                            this.logger.warn(`Could not find location data for ${this.locales.en[transit.description]}`);
                            return false;
                        }
                        let conditions;
                        if (this.locales.en[transit.conditions ?? '']?.trim()) {
                            conditions = transit.conditions;
                        }
                        return {
                            id: `${transit.id}`,
                            description: this.addTranslation(`${transit.name}_DESC`),
                            map: transit.target,
                            conditions,
                            ...locationData.location,
                        };
                    }).filter(Boolean),
                    locks: this.mapDetails[id].locks.map(lock => {
                        const keyItem = this.items.get(lock.key);
                        if (!keyItem || keyItem.types.includes('disabled')) {
                            this.logger.warn(`Skipping lock for key ${lock.key}`)
                            return false;
                        }
                        return {
                            id: this.getId(id, lock),
                            lockType: lock.lockType,
                            key: lock.key,
                            needsPower: lock.needsPower || false,
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
                            id: this.getId(id, hazard),
                            hazardType: hazardType,
                            name: this.addTranslation(hazardName),
                            ...hazard.location,
                        };
                    }),
                    lootContainers: this.mapDetails[id].loot_containers.map(container => {
                        if (!container.lootParameters.Enabled) {
                            return false;
                        }
                        return {
                            lootContainer: this.getLootContainer(container),
                            position: container.location.position,
                        };
                    }).filter(Boolean),
                    /*lootPoints: this.mapDetails[id].loot_points.reduce((allLoot, rawLoot) => {
                        const duplicateLootPoint = allLoot.find(l => l.position.x === rawLoot.lootParameters.Position.x && l.position.y === rawLoot.lootParameters.Position.y && l.position.z === rawLoot.lootParameters.Position.z);
                        if (duplicateLootPoint) {
                            for (const id of rawLoot.lootParameters.FilterInclusive) {
                                if (!duplicateLootPoint.items.includes(id)) {
                                    duplicateLootPoint.items.push(id);
                                }
                            }
                            return allLoot;
                        }
                        allLoot.push({
                            //enabled: rawLoot.lootParameters.Enabled,
                            chanceModifier: rawLoot.lootParameters.ChanceModifier,
                            rarity: rawLoot.lootParameters.Rarity,
                            items: rawLoot.lootParameters.FilterInclusive,
                            position: rawLoot.lootParameters.Position,
                            //selectedFilters: rawLoot.selectedFilters, // always null
                            //spawnChance: rawLoot.lootParameters.SpawnChance, // always 0
                            //alwaysSpawn: rawLoot.lootParameters.IsAlwaysSpawn, // always false
                            //alwaysTrySpawnLoot: rawLoot.lootParameters.isAlwaysTrySpawnLoot, // always false
                            //static: rawLoot.lootParameters.IsStatic, // always false
                        });
                        return allLoot;
                    }, []),*/
                    switches: this.mapDetails[id].switches.map(sw => {
                        if (!sw.hasCollider) {
                            return false;
                        }
                        const switchId = `${sw.id}_${sw.name}`.replace(/^(?:switch_)?/i, 'switch_');
                        return {
                            id: this.getId(id, sw),
                            object_id: sw.id,
                            object_name: sw.name,
                            name: this.addTranslation(switchId),
                            door: sw.doorId,
                            switchType: sw.interactionType,
                            activatedBy: this.mapDetails[id].switches.reduce((found, current) => {
                                if (found) {
                                    return found;
                                }
                                if (!sw.previousSwitchId || !current.hasCollider) {
                                    return found;
                                }
                                if (current.id === sw.previousSwitchId) {
                                    found = this.getId(id, current);
                                }
                                return found;
                            }, false),
                            activates: [
                                ...sw.nextSwitches.map(so => {
                                    return {
                                        operation: so.operation,
                                        switch: this.mapDetails[id].switches.reduce((found, current) => {
                                            if (found) {
                                                return found;
                                            }
                                            if (!current.hasCollider) {
                                                return found;
                                            }
                                            if (current.id === so.targetSwitchId) {
                                                found = this.getId(id, current);
                                            }
                                            return found;
                                        }, false),
                                    }
                                }).filter(so => so.switch),
                                this.mapDetails[id].extracts.reduce((found, extract) => {
                                    if (found || !sw.extractId) {
                                        return found;
                                    }
                                    if (extract.name === sw.extractId && extract.exfilSwitchIds.includes(sw.id)) {
                                        found = {
                                            operation: "Unlock",
                                            extract: this.getId(id, extract)
                                        };
                                    }
                                    return found;
                                }, null)
                            ].filter(Boolean),
                            ...sw.location,
                        };
                    }).filter(Boolean),
                    stationaryWeapons: this.mapDetails[id].stationary_weapons.map(sw => {
                        return {
                            stationaryWeapon: this.getStationaryWeapon(sw.weaponItemId),
                            position: sw.location.position,
                        }
                    }),
                    minPlayerLevel: map.RequiredPlayerLevelMin,
                    maxPlayerLevel: map.RequiredPlayerLevelMax,
                    accessKeys: map.AccessKeys,
                    accessKeysMinPlayerLevel: map.MinPlayerLvlAccessKeys,
                };
                this.logger.log(`✔️ ${this.getTranslation(mapData.name)} ${id}`);
                mapData.normalizedName = this.normalizeName(this.getTranslation(mapData.name));
    
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
                    bossData.id = bossInfo.id;
                    const newBoss = !enemySet.has(bossData.id);
                    if (bossData.spawnChance === 0) {
                        continue;
                    }
                    if (spawn.TriggerName === 'botEvent' && spawn.TriggerId === 'BossBoarBorn') {
                        // filter out Kaban's sniper followers
                        continue;
                    }
                    enemySet.add(bossData.id);
                    if (newBoss) {
                        this.logger.log(` - ${this.getTranslation(bossInfo.name)}`);
                    }
                    const locationCount = {};
                    const spawnKeys = spawn.BossZone.split(',').filter(Boolean);
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
                    if (spawn.BossEscortAmount !== '0' && !spawn.Supports?.length) {
                        let enemyData = await this.getBossInfo(spawn.BossEscortType);
                        const newMob = !enemySet.has(enemyData.id);
                        enemySet.add(enemyData.id);
                        bossData.escorts.push({
                            id: enemyData.id,
                            amount: getChances(spawn.BossEscortAmount, 'count', true), 
                        });
                        if (newMob) {
                            this.logger.log(` - ${this.getTranslation(enemyData.name)}`);
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
                                this.logger.log(` - ${this.getTranslation(enemyData.name)}`);
                            }
                        }
                    }
                    for (const followerSpawn of map.BossLocationSpawn) {
                        if (followerSpawn.TriggerName !== 'botEvent') {
                            continue;
                        }
                        if (followerSpawn.BossChance === 0 || followerSpawn.BossEscortAmount === '0') {
                            continue;
                        }
                        const bossNameLower = spawn.BossName.toLowerCase();
                        if (followerSpawn.TriggerId.toLowerCase() !== `${bossNameLower}born`) {
                            continue;
                        }
                        const enemyData = await this.getBossInfo(followerSpawn.BossName);
                        const newMob = !enemySet.has(enemyData.id);
                        enemySet.add(enemyData.id);
                        bossData.escorts.push({
                            id: enemyData.id,
                            amount: getChances(followerSpawn.BossEscortAmount, 'count', true), 
                        });
                        if (newMob) {
                            this.logger.log(` - ${this.getTranslation(enemyData.name)}`);
                        }
                    }
    
                    if (spawn.TriggerId && spawn.TriggerName === 'interactObject') {
                        const switchId = this.mapDetails[id].switches.reduce((found, current) => {
                            if (found) {
                                return found;
                            }
                            if (current.id === spawn.TriggerId) {
                                found = current.id;
                            }
                            return found;
                        }, false)
                        if (switchId) {
                            //bossData.spawnTrigger = this.addTranslation('SwitchActivation');
                            bossData.switch = this.getId(id, {id: switchId});
                            bossData.switch_id = switchId;
                        } else {
                            this.logger.warn(`Could not find switch ${spawn.TriggerId}`);
                        }
                        if (this.locales.en[spawn.TriggerId]) {
                            bossData.spawnTrigger = this.addTranslation(spawn.TriggerId);
                        } else if (switchId) {
                            bossData.spawnTrigger = this.addTranslation('Switch');
                        }
                    }
                    mapData.bosses.push(bossData);
                }
                mapData.enemies = [...enemySet].map(enemy => this.addMobTranslation(enemy));
    
                this.kvData[gameMode.name].Map.push(mapData);
            }

            this.kvData[gameMode.name].GoonReport = this.goonReports.sort((a, b) => b.timestamp - a.timestamp).map(report => {
                const map = this.kvData[gameMode.name].Map.find(m => m.nameId === report.map);
                if (!map) {
                    this.logger.warn(`Could not find ${report.map} map`);
                    return false;
                }
                return {
                    map: map.id,
                    timestamp: `${report.timestamp.getTime()}`,
                }
            }).filter(Boolean);
    
            //const queueTimes = await mapQueueTimes(maps.data, this.logger);
            this.kvData[gameMode.name].Map = this.kvData[gameMode.name].Map.sort((a, b) => a.name.localeCompare(b.name)).map(map => {
                return {
                    ...map,
                    //queueTimes: queueTimes[map.id]
                };
            });
            this.logger.log(`Processed ${this.kvData[gameMode.name].Map.length} ${gameMode.name} maps`);
    
            this.kvData[gameMode.name].MobInfo = this.processedBosses;
            this.kvData[gameMode.name].LootContainer = this.lootContainers;
            this.kvData[gameMode.name].StationaryWeapon = this.stationaryWeapons;
            this.logger.log(`Processed ${Object.keys(this.kvData[gameMode.name].MobInfo).length} mobs`);
            for (const mob of Object.values(this.kvData[gameMode.name].MobInfo)) {
                //this.logger.log(`✔️ ${this.kvData.locale.en[mob.name]}`);
            }
    
            let kvName = this.kvName;
            if (gameMode.name !== 'regular') {
                kvName += `_${gameMode.name}`;
            }
            await this.cloudflarePut(this.kvData[gameMode.name], kvName);
        }
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
        const ornaments = [
            '5df8a6a186f77412640e2e80', // red
            '5df8a72c86f77412640e2e83', // white
            '5df8a77486f77412672a1e3f', // purple
        ];
        if (ornaments.includes(id)) {
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
        for (const preset of Object.values(this.presets.presets)) {
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
                if (!this.items.has(modId)) {
                    continue;
                }
                if (this.items.get(modId).types.includes('disabled')) {
                    continue;
                }
                if (mods.some(m => m.item === modId)) {
                    continue;
                }
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
            name: this.addMobTranslation(bossKey),
            normalizedName: this.normalizeName(this.getTranslation(bossKey, 'en')),
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
                    equipmentItem.item_name = this.presets.locale.en[preset.name];
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
            if (slotName === 'SecuredContainer') {
                continue;
            }
            for (const id in bossExtraData.inventory.items[slotName]) {
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

    getLootContainer(c) {
        const templateSubs = {
            '5ad74cf586f774391278f6f0': '578f879c24597735401e6bc6' // Cash register TAR2-2 to Cash register
        };
        const nameSubs = {
            '5d07b91b86f7745a077a9432': 'ShturmanStash',
        };
        const templateId = templateSubs[c.template] || c.template;
        if (this.lootContainers[templateId]) {
            return templateId;
        }
        const translationKey = nameSubs[templateId] || `${templateId} Name`;
        const container = {
            id: templateId,
            name: this.addTranslation(translationKey),
            normalizedName: this.normalizeName(this.locales.en[translationKey]),
        };
        this.lootContainers[container.id] = container;
        return container.id;
    }

    getStationaryWeapon(id) {
        if (this.stationaryWeapons[id]) {
            return id;
        }
        const weap = {
            id: id,
            name: this.addTranslation(`${id} Name`),
            shortName: this.addTranslation(`${id} ShortName`),
            normalizedName: this.normalizeName(this.locales.en[`${id} Name`]),
        };
        this.stationaryWeapons[weap.id] = weap;
        return weap.id;
    }

    getId(mapId, obj) {
        let hashString = mapId;
        if (typeof obj === 'string') {
            obj = {id: obj};
        }
        if (obj.id) {
            hashString += obj.id;
        }
        if (obj.name) {
            hashString += obj.name;
        }
        if (obj.settings?.Name) {
            hashString += obj.settings?.Name;
        }
        if (hashString === mapId) {
            hashString += `${obj.location.position.x}${obj.location.position.y}${obj.location.position.z}`;
        }
        const shasum = crypto.createHash('sha1');
        return shasum.update(hashString).digest('hex');
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

export default UpdateMapsJob;
