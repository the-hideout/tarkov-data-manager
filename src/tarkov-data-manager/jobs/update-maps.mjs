import fs from 'node:fs';
import crypto from 'node:crypto';

import DataJob from '../modules/data-job.mjs';
import remoteData from '../modules/remote-data.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
//import mapQueueTimes from '../modules/map-queue-times';
import s3 from '../modules/upload-s3.mjs';
import npcImageMaker from '../modules/npc-image-maker.mjs';
import presetData from '../modules/preset-data.mjs';

const enableMaps = [
    '59fc81d786f774390775787e', // night factory
    '6733700029c367a3d40b02af', // Labyrinth
    '5714dbc024597771384a510d', // Interchange
    '5704e4dad2720bb55b8b4567', // Lighthouse
    '5704e5fad2720bc05b8b4567', // Reserve
    '5704e554d2720bac5b8b456e', // Shoreline
    '5714dc692459777137212e12', // Streets of Tarkov
    '5704e3c2d2720bac5b8b4567', // Woods
    '5b0fc42d86f7744a585f9105', // Labs
    '65cc8f81a9aac3e77d0cfd3e', // Terminal
    //'6925a2c38bdebd9e2302692e', // Terminal?
];

class UpdateMapsJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-maps', loadLocales: true});
        this.kvName = 'map_data';
    }

    run = async () => {
        this.logger.log('Getting maps data...');
        [
            this.items,
            this.botInfo,
            this.botGroups,
            this.mapDetails,
            this.mapLoot,
            this.eftItems,
            this.hideout,
            this.botsHealth,
            this.goonReports,
        ] = await Promise.all([
            remoteData.get(),
            tarkovData.botsInfo(),
            tarkovData.botGroups(),
            tarkovData.mapDetails(),
            tarkovData.mapLoot(),
            tarkovData.items(),
            tarkovData.areas(),
            tarkovData.botsHealth().then(json => json.groups),
            this.query('SELECT * FROM goon_reports WHERE timestamp >= now() - INTERVAL 1 DAY'),

        ]);
        this.mapRotationData = JSON.parse(fs.readFileSync('./data/map_coordinates.json'));
        this.bossLoadouts = {};
        this.processedBosses = {};
        this.lootContainers = {};
        this.stationaryWeapons = {};
        this.s3Images = s3.getLocalBucketContents();
        this.kvData = {};
        this.presets = remoteData.getPresets();

        // prepare loose loot data per map
        this.mapLooseLoot = {};
        this.foundNeededForHideout = [];
        this.notFoundNeededForHideout = [];
        for (const mapId in this.mapLoot) {
            // collapse items contained within items down to a a single item
            this.mapLooseLoot[mapId] = [
                ...(this.mapLoot[mapId].spawnpoints?.map(sp => this.processLootSpawnPointItems(sp)) ?? []),
                ...(this.mapLoot[mapId].spawnpointsForced?.map(sp => this.processLootSpawnPointItems(sp)) ?? []),
            ];
            this.mapLooseLoot[mapId] = this.mapLooseLoot[mapId].filter(sp => sp.template.Items.length > 0);
            // remove standalone powerbank spawns
            this.mapLooseLoot[mapId] = this.mapLooseLoot[mapId].filter(sp => {
                if (sp.template.Items.length > 1) {
                    return true;
                }
                if (sp.template.Items[0]._tpl !== '5af0561e86f7745f5f3ad6ac') {
                    return true;
                }
                return false;
            });
            const nearPositions = (pos, positions) => {
                const axes = ['x', 'y', 'z'];
                positionLoop: for (const pos2 of positions) {
                    for (const axis of axes) {
                        if (Math.abs(pos[axis] - pos2[axis]) > 1.5) {
                            continue positionLoop;
                        }
                    }
                    return true;
                }
                return false;
            };
            // group clustered loose loot spawns together
            this.mapLooseLoot[mapId] = this.mapLooseLoot[mapId].reduce((lootPoints, lootPoint, currentIndex, spawnpoints) => {
                if (lootPoint.grouped) {
                    return lootPoints;
                }
                lootPoint.positions = [lootPoint.template.Position];
                spawnpoints.slice(currentIndex).filter((sp) => {
                    if (sp === lootPoint) {
                        return false;
                    }
                    if (sp.grouped) {
                        return false;
                    }
                    return nearPositions(sp.template.Position, lootPoint.positions);
                }).forEach(sp => {
                    sp.grouped = true;
                    sp.template.Items.forEach(i => {
                        if (lootPoint.template.Items.some(i2 => i._tpl === i2._tpl)) {
                            return;
                        }
                        lootPoint.template.Items.push(i);
                    });
                    lootPoint.positions.push(sp.template.Position);
                });
                lootPoints.push(lootPoint);
                return lootPoints;
            }, []);
            this.mapLooseLoot[mapId].forEach((lootPoint) => {
                const totals = lootPoint.positions.reduce((sum, pos) => {
                    return {
                        x: sum.x + pos.x,
                        y: sum.y + pos.y,
                        z: sum.z + pos.z,
                    };
                }, {x: 0, y: 0, z: 0});
                lootPoint.position = {
                    x: totals.x / lootPoint.positions.length,
                    y: totals.y / lootPoint.positions.length,
                    z: totals.z / lootPoint.positions.length,
                };
            });
        }
        
        for (const gameMode of this.gameModes) {
            this.kvData[gameMode.name] = {
                Map: [],
            };
            const [locations, globals] = await Promise.all([
                tarkovData.locations({gameMode: gameMode.name}),
                tarkovData.globals({gameMode: gameMode.name}),
            ]);
            this.logger.log(`Processing ${gameMode.name} maps...`);
            for (const id in locations.locations) {
                const map = locations.locations[id];
                if (!enableMaps.includes(id) && (!map.Enabled || map.Locked)) {
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
                        if (id === '68236e8153654e8c1200798a') {
                            const mapName = lang[id] ?? this.locales.en[id] ?? 'Ground Zero';
                            const tutorialKey = 'Tutorial_ConfirmationDialog_Title';
                            const tutorial = lang[tutorialKey] ?? this.locales.en[tutorialKey] ?? 'Tutorial';
                            return `${mapName} ${tutorial}`;
                        }
                        return lang[`${id} Name`];
                    }),
                    normalizedName: '', // set below using the EN translation of name
                    nameId: map.Id,
                    description: this.addTranslation(`${id} Description`),
                    wiki: this.getWikiLink(this.locales.en[`${id} Name`]),
                    enemies: [],
                    raidDuration: map.EscapeTimeLimit,
                    players: map.MinPlayers+'-'+map.MaxPlayers,
                    bosses: [],
                    coordinateToCardinalRotation: this.mapDetails[id]?.north_rotation ?? 180,
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
                        if (!zoneName && this.mapDetails[id]) {
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
                    extracts: this.mapDetails[id]?.extracts.map(extract => {
                        let transferItem;
                        const extractData = map.exits.find(e => e.Name === extract.settings.Name);
                        if (extractData?.PassageRequirement === 'TransferItem') {
                            transferItem = {
                                item: extractData.Id,
                                count: extractData.Count,
                            };
                        }
                        const secretExit = map.secretExits?.find(s => s.Name === extract.settings.Name);
                        if (secretExit) {
                            transferItem = {
                                item: secretExit.Id,
                                count: 1,
                            };
                        }
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
                            transferItem,
                            ...extract.location,
                        };
                    }) ?? [],
                    transits: map.transits?.map(transit => {
                        if (!transit.active) {
                            return false;
                        }
                        const locationData = this.mapDetails[id]?.transits.find(t => t.id === transit.id);
                        if (!locationData) {
                            this.logger.warn(`Could not find location data for ${this.locales.en[transit.description]}`);
                            return false;
                        }
                        let conditions;
                        if (this.locales.en[transit.conditions ?? '']?.trim()) {
                            conditions = this.addTranslation(transit.conditions);
                        }
                        return {
                            id: `${transit.id}`,
                            description: this.addTranslation(`${transit.name}_DESC`),
                            map: transit.target,
                            conditions,
                            ...locationData.location,
                        };
                    }).filter(Boolean) ?? [],
                    locks: this.mapDetails[id]?.locks.map(lock => {
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
                    }).filter(Boolean) ?? [],
                    hazards: this.mapDetails[id]?.hazards.map(hazard => {
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
                    }) ?? [],
                    lootContainers: this.mapDetails[id]?.loot_containers.map(container => {
                        if (!container.lootParameters.Enabled) {
                            return false;
                        }
                        if (container.template === '67614e3a6a90e4f10b0b140d') {
                            return false; // skip festive air drops
                        }
                        return {
                            lootContainer: this.getLootContainer(container),
                            position: container.location.position,
                        };
                    }).filter(Boolean) ?? [],
                    lootLoose: this.mapLooseLoot[id]?.map(point => {
                        const itemIds = point.template.Items.map(i => i._tpl).filter(id => this.items.has(id) && !this.items.get(id).types.includes('disabled') && !this.items.get(id).types.includes('quest'));
                        if (itemIds.length === 0) {
                            return false;
                        }
                        return {
                            position: point.position,
                            items: itemIds,
                        };
                    }).filter(Boolean) ?? [],
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
                    switches: this.mapDetails[id]?.switches.map(sw => {
                        if (!sw.hasCollider) {
                            return false;
                        }
                        const switchId = `${sw.id}_${sw.name}`.replace(/^(?:switch_)?/i, 'switch_');
                        if (switchId.startsWith('switch_custom_Light') || switchId.startsWith('switch_develop_00000')) {
                            return false;
                        }
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
                    }).filter(Boolean) ?? [],
                    stationaryWeapons: this.mapDetails[id]?.stationary_weapons.map(sw => {
                        return {
                            stationaryWeapon: this.getStationaryWeapon(sw.weaponItemId),
                            position: sw.location.position,
                        }
                    }) ?? [],
                    btrRoutes: [],
                    btrStops: [],
                    minPlayerLevel: map.RequiredPlayerLevelMin,
                    maxPlayerLevel: map.RequiredPlayerLevelMax,
                    accessKeys: map.AccessKeys,
                    accessKeysMinPlayerLevel: map.MinPlayerLvlAccessKeys,
                };
                this.logger.log(`✔️ ${this.getTranslation(mapData.name)} ${id}`);
                //console.log(mapData.lootLoose.length);
                mapData.normalizedName = this.normalizeName(this.getTranslation(mapData.name));
    
                if (this.mapRotationData[id]) {
                    mapData.coordinateToCardinalRotation = this.mapRotationData[id].rotation;
                }
    
                if (typeof idMap[id] !== 'undefined') mapData.tarkovDataId = idMap[id];
    
                const enemySet = new Set();
                for (const wave of map.waves) {
                    if (wave.WildSpawnType === 'assault' || wave.WildSpawnType === 'assaultTutorial') {
                        enemySet.add('scavs');
                    } else if (wave.WildSpawnType === 'marksman') {
                        enemySet.add('sniper');
                    }
                }
                for (const spawn of map.BossLocationSpawn) {
                    if (spawn.BossName === 'tagillaHelperAgro') {
                        enemySet.add('scavs');
                        continue;
                    }
                    if (spawn.BossName === 'civilian') {
                        continue;
                    }
                    if (spawn.BossName === 'assault' || spawn.BossName === 'assaultTutorial') {
                        enemySet.add('scavs');
                        continue;
                    }
                    if (spawn.BossName === 'bossKillaAgro') {
                        const tagillaSpawn = mapData.bosses.find(s => s.id === 'bossTagillaAgro');
                        if (!tagillaSpawn) {
                            continue;
                        }
                        const enemyData = await this.getBossInfo(spawn.BossName);
                        const newMob = !enemySet.has(enemyData.id);
                        enemySet.add(enemyData.id);
                        tagillaSpawn.escorts.push({
                            id: enemyData.id,
                            amount: [{
                                chance: parseFloat(spawn.BossChance) / 100,
                                count: 1,
                            }], 
                        });
                        if (newMob) {
                            this.logger.log(` - ${this.getTranslation(enemyData.name)}`);
                        }
                        continue;
                    }
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
                                //this.logger.warn(`No translation found for spawn location ${locationCount[locationName].key}`);
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

                const artillerySettings = globals.config.ArtilleryShelling?.ArtilleryMapsConfigs?.[mapData.nameId];
                if (artillerySettings) {
                    mapData.artillery = {
                        zones: artillerySettings.ShellingZones.map(zone => {
                            if (!zone.IsActive) {
                                return false;
                            }
                            const gridX = ((zone.Points.x-1)*zone.GridStep.x)+zone.PointRadius * 2;
                            const gridY = ((zone.Points.y-1)*zone.GridStep.y)+zone.PointRadius * 2;
                            const height = 10;
                            return {
                                id: `${zone.ID}`,
                                position: zone.Center,
                                size: {
                                    x: gridX,
                                    y: height,
                                    z: gridY,
                                },
                                /*outline: [
                                    {
                                        x: zone.Center.x - (gridX / 2),
                                        y: zone.Center.y,
                                        z: zone.Center.z + (gridY / 2),
                                    },
                                    {
                                        x: zone.Center.x + (gridX / 2),
                                        y: zone.Center.y,
                                        z: zone.Center.z + (gridY / 2),
                                    },
                                    {
                                        x: zone.Center.x + (gridX / 2),
                                        y: zone.Center.y,
                                        z: zone.Center.z - (gridY / 2),
                                    },
                                    {
                                        x: zone.Center.x - (gridX / 2),
                                        y: zone.Center.y,
                                        z: zone.Center.z - (gridY / 2),
                                    },
                                ],*/
                                outline: this.getArtilleryZoneOutline(zone),
                                top: zone.Center.y + (height / 2),
                                botom: zone.Center.y - (height / 2),
                                radius: zone.PointRadius,
                            }
                        }).filter(Boolean),
                    };
                }

                const getWaypoint = (waypointId) => {
                    return this.mapDetails[id].path_destinations.find(pd => pd.id === waypointId)?.location.position;
                };

                if (globals.config.BTRSettings.MapsConfigs[map.Id] && this.mapDetails[id]) {
                    const pathPoints = new Set();
                    for (const pathConfig of globals.config.BTRSettings.MapsConfigs[map.Id].pathsConfigurations) {
                        if (!pathConfig.active) {
                            continue;
                        }
                        mapData.btrRoutes.push({
                            waypoints: [
                                //getWaypoint(pathConfig.enterPoint),
                                ...pathConfig.pathPoints.map(waypoint => getWaypoint(waypoint)),
                                //getWaypoint(pathConfig.exitPoint),
                            ].filter(Boolean),
                        });
                        pathConfig.pathPoints.forEach(p => pathPoints.add(p));
                    }
                    for (const pathPoint of pathPoints.values()) {
                        const stopNameKey = `Trading/Dialog/PlayerTaxi/${mapData.nameId}/${pathPoint}/Name`;
                        if (!this.locales.en[stopNameKey]) {
                            continue;
                        }
                        const waypoint = getWaypoint(pathPoint);
                        if (!waypoint) {
                            continue;
                        }
                        mapData.btrStops.push({
                            name: this.addTranslation(stopNameKey),
                            ...waypoint,
                        })
                    }
                }
    
                this.kvData[gameMode.name].Map.push(mapData);
            }

            this.kvData[gameMode.name].GoonReport = this.goonReports.sort((a, b) => b.timestamp - a.timestamp).map(report => {
                const map = this.kvData[gameMode.name].Map.find(m => m.nameId === report.map);
                if (!map) {
                    this.logger.warn(`Could not find ${report.map} map`);
                    return false;
                }
                if (report.game_mode !== gameMode.name) {
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
            '6937ed118715e9fd1b0f286d', // tangerine
        ];
        if (ornaments.includes(id)) {
            return false;
        }
        return true;
    }

    getItemTopParent = (item, items) => {
        if (!item.parentId) {
            return;
        }
        let parent = item;
        while (parent) {
            if (parent.parentId === items[0]._id) {
                return parent;
            }
            parent = items.find(i => i._id === parent.parentId);
        }
    }

    getItemSlot = (item, items) => {
        const parent = this.getItemTopParent(item, items);
        if (!parent) {
            return;
        }
        return parent.slotId;
    }

    fillItemContents = (item, items, contains = []) => {
        for (const it of items) {
            if (it._id === item._id) {
                continue;
            }
            if (!this.isValidItem(it._tpl)) {
                continue;
            }
            const topParent = this.getItemTopParent(it, items);
            if (!topParent) {
                continue;
            }
            if (topParent._id !== item._id) {
                continue;
            }
            const parent = items.find(i => i._id === it.parentId);
            if (!parent) {
                continue;
            }
            contains.push({
                item: it._tpl,
                item_name: this.items.get(it._tpl).name,
                count: 1,
                attributes: [
                    {
                        name: 'parentItemId',
                        value: parent._tpl,
                    },
                    {
                        name: 'slotNameId',
                        value: it.slotId,
                    }
                ],
            });
        }
    }

    buildPreset = (item, items) => {
        const preset = {
            _id: '000000000000000000000000',
            _items: [
                {...item}
            ],
        };
        delete preset._items[0].parentId;
        delete preset._items[0].slotId;
        for (const it of items) {
            const parent = this.getItemTopParent(it, items);
            if (!parent) {
                continue;
            }
            if (parent._id !== item._id) {
                continue;
            }
            preset._items.push(it);
        }
        return preset;
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
            if (preset.propertiess.items[0]._tpl !== baseItemId) {
                continue;
            }
            const presetParts = preset.properties.items.filter(i => i._tpl !== preset.baseId).filter(i => !this.items.get(i._tpl).types.includes('ammo'));
            if (presetParts.length !== containedParts.length) {
                continue;
            }
            const partIsMissing = presetParts.some(contained => {
                return !containedParts.some(part => contained._tpl === part.item);
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
        const originalBossKey = bossKey.toLowerCase();
        bossKey = this.getMobKey(bossKey);
        if (this.processedBosses[bossKey]) {
            return this.processedBosses[bossKey];
        }
        const bossInfo = {
            id: bossKey,
            name: this.addMobTranslation(bossKey),
            normalizedName: this.normalizeName(this.getTranslation(bossKey, 'en')),
            imagePortraitLink: `https://${process.env.S3_BUCKET}/unknown-npc-portrait.webp`,
            imagePosterLink: `https://${process.env.S3_BUCKET}/unknown-npc-poster.webp`,
            equipment: [],
            items: [],
        };
        const bossExtraData = this.botInfo.groups.filter(g => g.role.toLowerCase() === bossKey.toLowerCase());
        const extensions = [
            'webp',
            'png',
            'jpg',
        ];
        const imageSizes = ['Portrait', 'Poster'];
        const forceImageUpdate = [];
        for (const imageSize of imageSizes) {
            let found = false;
            for (const ext of extensions) {
                if (forceImageUpdate.includes('all') || forceImageUpdate.includes(bossKey)) {
                    break;
                }
                const fileName = `${bossInfo.normalizedName}-${imageSize.toLowerCase()}.${ext}`;
                if (this.s3Images.includes(fileName)) {
                    bossInfo[`image${imageSize}Link`] = `https://${process.env.S3_BUCKET}/${fileName}`;
                    found = true;
                    break;
                }
            }
            if (found || imageSize === 'Portrait') {
                continue;
            }
            let imageData;
            if (npcImageMaker.hasCustomData(bossKey)) {
                try {    
                    imageData = npcImageMaker.getCustomData(bossKey);
                } catch (error) {
                    this.logger.warn(`Error getting ${bossKey} custom image data: ${error.message}`);
                }
                
            }
            if (!imageData && bossExtraData.length) {
                try {    
                    imageData = this.bossDataToImageData(bossExtraData[0]);
                } catch (error) {
                    this.logger.warn(`Error getting ${bossKey} image data: ${error.message}`);
                }
            }
            if (!imageData) {
                continue;
            }
            let image;
            try {    
                image = await npcImageMaker.requestImage(imageData);
            } catch (error) {
                this.logger.warn(`Error getting ${bossKey} image: ${error.message}`);
            }
            if (!image) {
                continue;
            }
            const posterFilename = `${bossInfo.normalizedName}-${imageSize.toLowerCase()}.webp`;
            await s3.uploadAnyImage(image, posterFilename, 'image/webp');
            this.s3Images.push(posterFilename);
            const portraitFilename = `${bossInfo.normalizedName}-portrait.webp`;
            await s3.uploadAnyImage(image.resize(128, 128), portraitFilename, 'image/webp');
            this.s3Images.push(portraitFilename);
        }
        const bossHealth = this.botsHealth.find(b => b.role.toLowerCase() === originalBossKey);
        if (bossHealth) {
            bossInfo.health = bossHealth.healthParts.map(healthPart => {
                return {
                    id: healthPart.bodyPart,
                    bodyPart: this.addTranslation(`QuestCondition/Elimination/Kill/BodyPart/${healthPart.bodyPart}`),
                    max: healthPart.hp,
                };
            });
        }
        this.processedBosses[bossKey] = bossInfo;
        if (!bossExtraData.length) {
            return bossInfo;
        }
        for (const difficulty of bossExtraData) {
            for (const render of difficulty.renders) {
                for (const item of render.data.Equipment.items) {
                    if (!item.parentId) {
                        continue;
                    }
                    if (!this.isValidItem(item._tpl)) {
                        continue;
                    }
                    const slotName = this.getItemSlot(item, render.data.Equipment.items);
                    const topLevel = item.parentId === render.data.Equipment.Id;
                    
                    const equipmentItem = {
                        item: item._tpl,
                        item_name: this.items.get(item._tpl).name,
                        contains: [],
                        count: 1,
                        attributes: [
                            {
                                name: 'slot',
                                value: item.slotId,
                            }
                        ]
                    };
                    const weaponsSlots = [
                        'FirstPrimaryWeapon',
                        'SecondPrimaryWeapon',
                        'Holster',
                    ];
                    if (weaponsSlots.includes(slotName)) {
                        if (!topLevel) {
                            continue;
                        }
                        this.fillItemContents(item, render.data.Equipment.items, equipmentItem.contains);
                        const preset = presetData.findPreset(this.buildPreset(item, render.data.Equipment.items));
                        if (preset) {
                            equipmentItem.item = preset.id;
                            equipmentItem.item_name = preset.name;
                        }
                    }
                    bossInfo.equipment.push(equipmentItem);
                }
            }
        }
        const lootDifficulties = this.botGroups.groups.filter(b => b.role.toLowerCase() === bossKey.toLowerCase());
        if (!lootDifficulties.length) {
            return bossInfo;
        }
        for (const difficulty of lootDifficulties) {
            for (const lootItem of difficulty.items) {
                if (!this.isValidItem(lootItem.tpl)) {
                    continue;
                }
                const item = this.items.get(lootItem.tpl);
                const skipTypes = [
                    'wearable',
                    'gun',
                    'mods',
                    'ammo',
                ];
                if (item.types.some(t => skipTypes.includes(t))) {
                    continue;
                }
                bossInfo.items.push({
                    id: item.id,
                    name: item.name,
                    attributes: [
                        {
                            name: 'difficulty',
                            value: difficulty.difficulty,
                        },
                        {
                            name: 'prevalence',
                            value: +(Math.round(lootItem.botPresencePct + "e+2") + "e-2"),
                        }
                    ],
                });
            }
        }
        return bossInfo;
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
                    equipmentItem.item_name = this.items.get(preset.id);
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
        return bossInfo;
    }

    bossDataToImageData(bossExtraData) {
        const requestData = npcImageMaker.defaultData();
        requestData.customization = bossExtraData.renders[0].data.Customization;
        requestData.equipment = bossExtraData.renders[0].data.Equipment;
        return requestData;
        const bodyParts = [
            'head',
            'body',
            'hands',
            'feet',
        ];
        for (const bodyPart of bodyParts) {
            let bodyPartChosen;
            for (const bpid in bossExtraData.appearance[bodyPart]) {
                const weight = bossExtraData.appearance[bodyPart][bpid];
                if (!bodyPartChosen || weight > bodyPartChosen.weight) {
                    bodyPartChosen = {
                        id: bpid,
                        weight,
                    };
                }
            }
            if (bodyPartChosen) {
                requestData.customization[bodyPart] = bodyPartChosen.id;
            }
        }
        const equipmentSlots = [
            'Headwear',
            'FaceCover',
            'ArmorVest',
            'Eyewear',
            'TacticalVest',
            'Backpack',
            'Earpiece',
        ];
        const blacklistItems = [
            '5c066ef40db834001966a595' // Armasight NVG head strap
        ];
        let itemIndex = 1;
        // recursive function to add attachments to a given item
        const addModsForItem = (baseSlot, itemId, parentId) => {
            for (const modSlot in bossExtraData.inventory.mods[itemId]) {
                const modItemId = bossExtraData.inventory.mods[itemId][modSlot][0];
                if (blacklistItems.includes(modItemId)) {
                    continue;
                }
                if (conflictsWithItems(baseSlot, modItemId)) {
                    continue;
                }
                const modItem = {
                    _id: itemIndex.toString(16).padStart(24, '0'),
                    _tpl: modItemId,
                    parentId,
                    slotId: modSlot,
                };
                itemIndex++;
                if (this.eftItems[modItem._tpl]?._props?.FaceShieldComponent && this.eftItems[modItem._tpl]?._props?.HasHinge) {
                    modItem.upd = {
                        Togglable: {
                            On: true,
                        },
                    };
                }
                requestData.equipment.Items.push(modItem);
                addModsForItem(baseSlot, modItem._tpl, modItem._id);
            };
        };
        const conflictsWithItems = (slotId, itemId) => {
            const item = this.eftItems[itemId];
            return requestData.equipment.Items.some(loadoutItem => {
                const otherId = loadoutItem._tpl;
                const otherItem = this.eftItems[otherId];
                const itemConflict = item?._props.ConflictingItems.includes(otherId) ||
                    otherItem?._props.ConflictingItems.includes(itemId);
                if (itemConflict) {
                    return true;
                }
                const blockSlots = [
                    'Earpiece',
                    'Eyewear',
                    'FaceCover',
                    'Headwear',
                ];
                if (!blockSlots.includes(slotId)) {
                    return false;
                }
                return requestData.equipment.Items.some(loadoutItem => {
                    const otherId = loadoutItem._tpl;
                    const otherItem = this.eftItems[otherId];
                    return otherItem?._props[`Blocks${slotId}`] ||
                        item?._props[`Blocks${loadoutItem.slotId}`];
                });
            });
        };
        for (const slot of equipmentSlots) {
            let itemChosen;
            for (const itemId in bossExtraData.inventory.equipment[slot]) {
                if (blacklistItems.includes(itemId)) {
                    continue;
                }
                if (conflictsWithItems(slot, itemId)) {
                    continue;
                }
                const weight = bossExtraData.inventory.equipment[slot][itemId];
                if (!itemChosen || weight > itemChosen.weight) {
                    itemChosen = {
                        id: itemId,
                        weight,
                    };
                }
            }
            if (!itemChosen) {
                // no item for this slot
                continue;
            }
            const equipmentItemId = itemIndex.toString(16).padStart(24, '0');
            requestData.equipment.Items.push({
                _id: equipmentItemId,
                _tpl: itemChosen.id,
                parentId: requestData.equipment.Id,
                slotId: slot,
            });
            itemIndex++;
            if (!bossExtraData.inventory.mods[itemChosen.id]) {
                continue;
            }
            addModsForItem(slot, itemChosen.id, equipmentItemId);
        }
        return requestData;
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

    getArtilleryZoneOutline(zone) {
        const gridX = ((zone.Points.x-1)*zone.GridStep.x)+zone.PointRadius * 2;
        const gridY = ((zone.Points.y-1)*zone.GridStep.y)+zone.PointRadius * 2;

        const points = [];
        const directions = [1, -1];
        const directionsX = [-1, 1, 1, -1]
        let dirXIndex = 0;
        for (let dirYIndex = 0; dirYIndex < directions.length; dirYIndex ++) {
            const dirY = directions[dirYIndex];
            for (dirXIndex = dirYIndex ? 2: 0; dirXIndex < directionsX.length - (dirYIndex ? 0 : 2); dirXIndex++) {
                const dirX = directionsX[dirXIndex];
                let x = zone.Center.x + ((gridX*dirX) / 2);
                let y = zone.Center.z + ((gridY*dirY) / 2);
                points.push({
                    x,
                    y: zone.Center.y,
                    z: y,
                });
            }
        }
        if (zone.Rotate) {
            const angleRadians = (zone.Rotate * -1 * Math.PI) / 180;

            // Calculate the center of the rectangle
            const centerX = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
            const centerY = (points[0].z + points[1].z + points[2].z + points[3].z) / 4;

            // Function to rotate a single point
            const rotatePoint = (x, y, z) => {
                const translatedX = x - centerX;
                const translatedY = z - centerY;
                
                const rotatedX = translatedX * Math.cos(angleRadians) - translatedY * Math.sin(angleRadians);
                const rotatedY = translatedX * Math.sin(angleRadians) + translatedY * Math.cos(angleRadians);
                
                return {
                x: rotatedX + centerX,
                y,
                z: rotatedY + centerY,
                };
            };

            // Rotate each point
            return points.map(point => rotatePoint(point.x, point.y, point.z));
        }
        return points;
    }

    processLootSpawnPointItems(sp) {
        const spawnPointItems = sp.template.Items.reduce((allItems, current) => {
            if (looseLootBlacklistItems.includes(current._tpl)) {
                return allItems;
            }
            if (!looseLootWhitelistCategories.includes(this.eftItems[current._tpl]?._parent) &&
                //!this.looseLootNeededForHideout(current._tpl) && 
                !looseLootWhitelistItems.includes(current._tpl)
            ) {
                return allItems;
            }
            if (current.parentId) {
                const parent = allItems.find(i => i._id === current.parentId);
                if (parent) {
                    if (!parent.items) {
                        parent.items = [];
                    }
                    parent.items.push(current);
                }
            } else if (this.items.get(current._tpl)) {
                allItems.push(current);
            }
            return allItems;
        }, []);
        return {
            ...sp,
            template: {
                ...sp.template,
                Items: spawnPointItems,
            }
        };
    }

    looseLootNeededForHideout(id) {
        if (this.foundNeededForHideout.includes(id)) {
            return true;
        }
        if (this.notFoundNeededForHideout.includes(id)) {
            return false;
        }
        for (const stationId in this.hideout) {
            const station = this.hideout[stationId];
            for (const stageId in station.stages) {
                const stage = station.stages[stageId];
                for (const req of stage.requirements) {
                    if (req.type !== 'Item') {
                        continue;
                    }
                    if (req.templateId !== id) {
                        continue;
                    }
                    this.foundNeededForHideout.push(id);
                    return true;
                }
            }
        }
        this.notFoundNeededForHideout.push(id);
        return false;
    };
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
    SecretExfiltrationPoint: 'pmc',
};

const hazardMap = {
    SniperFiringZone: {
        id: 'sniper',
        name: 'ScavRole/Marksman',
    },
    Minefield: {
        id: 'minefield',
        name: 'DamageType_Landmine',
    },
    Hazard: {
        id: 'hazard',
        name: ''
    },
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
};

const looseLootWhitelistCategories = [
    '57864a3d24597754843f8721', // Jewelry
    '5c99f98d86f7745c314214b3', // Mechanical Key
    '5c164d2286f774194c5e69fa', // Keycard
    '5795f317245977243854e041', // Simple Container
    //'57864a66245977548f04a81f', // Electronics
    '5448f3a64bdc2d60728b456a', // Stims
    '5d650c3e815116009f6201d2', // Fuel
    '5448ecbe4bdc2d60728b4568', // Info Items
    '6759673c76e93d8eb20b2080', // Posters
];

const looseLootWhitelistItems = [
    '5c0530ee86f774697952d952', // LEDX
    '5af0534a86f7743b6f354284', // Ophthalmoscope
    '591094e086f7747caa7bb2ef', // Body Armor Repair Kit
    '5910968f86f77425cf569c32', // Weapon Repair Kit
    '57347ca924597744596b4e71', // Graphics Card
    '5c052f6886f7746b1e3db148', // COFDM
    '5c05308086f7746b2101e90b', // Virtex
    '5c052fb986f7746b2101e909', // RFID
    '6389c85357baa773a825b356', // Advanced Current Converter
    '6389c7f115805221fb410466', // Far-forward GPS Signal Amplifier Unit
    '6389c7750ef44505c87f5996', // Microcontroller board
    '5d0378d486f77420421a5ff4', // Military power filter
    '5d03784a86f774203e7e0c4d', // Military gyrotachometer
    '5d0377ce86f774186372f689', // Iridium military thermal vision module
    '5d03775b86f774203e7e0c4b', // Phased array element
    '5d0376a486f7747d8050965c', // Military circuit board
    '5d0375ff86f774186372f685', // Military cable
    '5c12620d86f7743f8b198b72', // Tetriz portable game console
    '5c05300686f7746dce784e5d', // VPX Flash Storage Module
    '5e2aee0a86f774755a234b62', // Cyclon rechargeable battery
    '5e2aedd986f7746d404f3aa4', // GreenBat lithium battery
    '5af0561e86f7745f5f3ad6ac', // Portable Powerbank
    '5c052e6986f7746b207bc3c9', // Portable defibrillator
    '5c12688486f77426843c7d32', // Paracord
    '5d1b385e86f774252167b98a', // Water filter
    '5d1b376e86f774252519444e', // Moonshine
];

const looseLootBlacklistItems = [
    '5df8a6a186f77412640e2e80', // Red Ornament
    '5df8a72c86f77412640e2e83', // White Ornament
    '5df8a77486f77412672a1e3f', // Purpose Ornament
    '5c10c8fd86f7743d7d706df3', // Adrenaline
    '573474f924597738002c6174', // Chainlet
];

export default UpdateMapsJob;
