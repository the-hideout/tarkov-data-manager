import tarkovDevData from "./tarkov-data-tarkov-dev.mjs";

const emptyData = {
    extracts: [],
    transits: [],
    doors: [],
    zones: [],
    hazards: [],
    locks: [],
    loot_points: [],
    loot_containers: [],
    stationary_weapons: [],
    switches: [],
    quest_items: [],
    spawns: [],
    path_destinations: [],
};

const excludedExtracts = {
    Shoreline: [
        {
            name: 'exit_ALL_alpinist_shoreline',
        }
    ],
    TarkovStreets: [
        { // Old Stylobate Building Elevator
            name: 'Exit_E1',
        },
        { // Old Scav Checkpoint
            name: 'Exit_E6',
        },
        { // new Scav Checkpoint
            name:'E6_new',
        },
        { // old Crash Site
            name: 'Exit_E4_new',
            requirements: {
                status: 'Pending',
            }
        }
    ]
};
const excludedZones = {
    RezervBase: [
        'fuel4',
    ],
};

const stationaryWeapons = {
    '5d319c3748f0354602135916': '5cdeb229d7f00c000e7ce174', // Utyos
    '5d7296aea4b93651e424b443': '5d52cc5ba4b9367408500062', // AGS-30
};

const extractFactionReplacement = {
    secret: 'pmc',
};

const addLocation = (obj) => {
    // for the new data, we have to negate the x value
    obj.location = {
        position: {
            x: obj.pos[0]*-1,
            y: obj.pos[1],
            z: obj.pos[2],
        },
    };
    if (obj.outline) {
        obj.location.outline = obj.outline?.reduce((points, point) => {
            if (!points.some(p => p[0]*-1 === point[0] && p[2] === point[2])) {
                points.push({
                    x: point[0]*-1,
                    y: point[1],
                    z: point[2],
                });
            }
            return points;
        }, []);
    }
    obj.location.top = obj.top;
    obj.location.bottom = obj.bottom;
    return obj;
};

const filterOutline = (obj) => {
    return {
        ...obj,
        outline: obj.outline?.reduce((points, point) => {
            if (!points.some(p => p[0] === point[0] && p[2] === point[2])) {
                points.push(point);
            }
            return points;
        }, []),
    };
};

const skipMaps = [
    'develop',
];

const mapDetailsTools = {
    getAllMapDetails: async (locations, items, en, options = {}) => {
        const duplicateMaps = {
            'factory4_day': Object.values(locations).find(m => m.Id === 'factory4_night'),
            'laboratory': Object.values(locations).find(m => m.Id === 'laboratory_dark'),
        };
        const mapDetails = {};
        const mapDetailsLegacy = {};
        const requests = [];
        const returnData = {};
        for (const id in locations.locations) {
            if (!en[`${id} Name`]) {
                continue;
            }
            returnData[id] = structuredClone(emptyData);
            const map = locations.locations[id];
            requests.push(mapDetailsTools.getMapDetails(map, items, options).then(data => {
                mapDetails[id] = data;
            }));
            requests.push(mapDetailsTools.getMapDetailsLegacy(map, options).then(data => {
                mapDetailsLegacy[id] = data;
            }));
        }
        await Promise.all(requests);
        for (const id in returnData) {
            for (const dataType in returnData[id]) {
                if (mapDetails[id]?.[dataType]?.length) {
                    returnData[id][dataType] = mapDetails[id][dataType];
                } else {
                    returnData[id][dataType] = mapDetailsLegacy[id][dataType];
                }
            }
            // keep old switch data
            returnData[id].switches = mapDetailsLegacy[id].switches;

            // keep old extract switch data
            for (const extract of returnData[id].extracts) {
                const legacyExtract = mapDetailsLegacy[id]?.extracts.find(e => e.name === e.settings.Name);
                if (!extract.exfilSwitchId) {
                    extract.exfilSwitchId = legacyExtract?.exfilSwitchId;
                }
                if (!extract.exfilSwitchIds) {
                    extract.exfilSwitchIds = legacyExtract?.exfilSwitchIds ?? [];
                }
            }

            // keep missing legacy zones
            for (const id in returnData) {
                const legacyData = mapDetailsLegacy[id];
                if (!legacyData) {
                    continue;
                }
                for (const zone of legacyData.zones) {
                    if (returnData[id].zones.some(z => z.id === zone.id)) {
                        continue;
                    }
                    returnData[id].zones.push(zone);
                }
            }

            for (const sourceId in duplicateMaps) {
                if (sourceId !== id) {
                    continue;
                }
                const targetMap = duplicateMaps[sourceId];
                if (!targetMap) {
                    continue;
                }
                returnData[targetMap._Id] ??= structuredClone(returnData[id]);
            }
        }
        return returnData;
    },

    getMapDetails: async (map, items, options = {}) => {
        let mapData;
        try {
            mapData = await tarkovDevData.mapData(map.Id, options);
        } catch (error) {
            if (error.message === '404 Not Found') {
                if (!map.Enabled && !map.Locked) {
                    console.warn(`No map details data for ${map.Id} ${map._Id}`);
                }
                return structuredClone(emptyData);
            }
            return Promise.reject(error);
        }
        const returnData = structuredClone(emptyData);
        returnData.extracts = mapData.exfils.reduce((extracts, extract) => {
            /*if (extract.location.size.x <= 1 && extract.location.size.y <= 1 && extract.location.size.z <= 1) {
                return extracts;
            }*/
            const excludeTest = excludedExtracts[map.Id]?.find(e => e.name === extract.name);
            if (excludeTest) {
                if (!excludeTest.requirements) {
                    return extracts;
                }
                /*let matched = true;
                for (const property in excludeTest.requirements) {
                    if (excludeTest.requirements[property] !== extract[property]) {
                        matched = false;
                        break;
                    }
                }
                if (matched) {
                    return extracts;
                }*/
            }
            let duplicateExtract = extracts.find(e => {
                if (e.name !== extract.name) {
                    return false;
                }
                if (e.pos[0] !== extract.pos[0] || e.pos[2] !== extract.pos[2]) {
                    return false;
                }
                return true;
            });
            if (duplicateExtract) {
                if (duplicateExtract.faction === 'pmc') {
                    duplicateExtract.faction = 'shared';
                    return extracts;
                }
                extracts = extracts.filter(e => e !== duplicateExtract);
                extract.faction = 'shared';
            }
            extract.faction = extractFactionReplacement[extract.faction] ?? extract.faction;
            extracts.push(extract);
            return extracts;
        }, []).map(extract => {
            switch (extract.faction){
                case 'scav':
                    extract.exfilType = 'ScavExfiltrationPoint';
                    break;
                case 'shared':
                    extract.exfilType = 'SharedExfiltrationPoint';
                    break;
                default:
                    extract.exfilType = 'ExfiltrationPoint';
            }

            return extract;
        }).map(extract => addLocation(extract));

        returnData.transits = mapData.transit_points.map(transit => addLocation(transit));

        returnData.doors = mapData.doors.map(door => addLocation(door));

        returnData.zones = mapData.quest_triggers
            .filter(z => !excludedZones[map.Id]?.includes(z.id))
            .map(zone => {
                addLocation(zone);
                zone.id = zone.name;
                return zone;
            });

        returnData.hazards = [
            ...mapData.minefields.map(hazard => {
                return {
                    ...hazard,
                    hazardType: 'Minefield',
                };
            }),
            ...mapData.mines_directional.map(hazard => {
                return {
                    ...hazard,
                    hazardType: 'Minefield',
                };
            }),
            ...mapData.sniper_zones.map(hazard => {
                return {
                    ...hazard,
                    hazardType: 'SniperFiringZone',
                };
            }),
        ].map(hazard => addLocation(hazard));
        
        returnData.locks = mapData.doors.map(door => {
            if (!door.key_id) {
                return;
            }
            return {
                ...door,
                key: door.key_id,
                lockType: door.kind,
            };
            /*return {
                ...door,
                needsPower: returnData.no_power?.some(pow => {
                    if (pow.location.position.x !== l.location.position.x) {
                        return false;
                    }
                    if (pow.location.position.y !== l.location.position.y) {
                        return false;
                    }
                    if (pow.location.position.z !== l.location.position.z) {
                        return false;
                    }
                    return true;
                }),
            }*/
        }).filter(Boolean).map(lock => addLocation(lock));
        returnData.loot_points = mapData.loose_points.map(point => addLocation(point));
        returnData.loot_containers = [];
        returnData.stationary_weapons = mapData.stationary?.map(stationary => {
            const tplId = stationaryWeapons[stationary.weapon_id];
            if (!tplId) {
                console.warn(`Unknown stationary weapon id ${stationary.weapon_id}`);
                return false;
            }
            stationary.weaponItemId = tplId;
            addLocation(stationary);
            return stationary;
        }).filter(Boolean) ?? [];

        returnData.switches = mapData.interaction_switches?.map(sw => {

        }) ?? [];
        returnData.quest_items = mapData.loose_points.map(point => {
            const questPoint = structuredClone(point);
            questPoint.items = questPoint.items.filter(i => {
                const item = items[i.tpl];
                if (!item) {
                    return false;
                }
                return item._props.QuestItem;
            });
            if (!questPoint.items.length) {
                return;
            }
            return questPoint;
        }).filter(Boolean).map(point => addLocation(point)); /* mapData.quest_items?.reduce((all, current) => {
            const p = current.location.position;
            if (p.x || p.y || p.z) {
                all.push(current);
            }
            return all;
        }, []) || [];*/
        returnData.spawns = mapData.spawn_points.map(spawn => addLocation(spawn));
        returnData.path_destinations = mapData.path_destinations || [];
        return returnData;
    },

    getMapDetailsLegacy: async (map, options = {}) => {
        let mapDetails;
        try {
            mapDetails = await tarkovDevData.mapDataLegacy(map.Id, options);
        } catch (error) {
            if (error.message === '404 Not Found') {
                if (!map.Enabled && !map.Locked) {
                    console.warn(`No map details data (legacy) for ${map.Id} ${map._Id}`);
                }
                return structuredClone(emptyData);
            }
            return Promise.reject(error);
        }

        mapDetails.extracts = mapDetails.extracts.reduce((extracts, extract) => {
            if (extract.location.size.x <= 1 && extract.location.size.y <= 1 && extract.location.size.z <= 1) {
                return extracts;
            }
            const excludeTest = excludedExtracts[map.Id]?.find(e => e.name === extract.name);
            if (excludeTest) {
                if (!excludeTest.requirements) {
                    return extracts;
                }
                let matched = true;
                for (const property in excludeTest.requirements) {
                    if (excludeTest.requirements[property] !== extract[property]) {
                        matched = false;
                        break;
                    }
                }
                if (matched) {
                    return extracts;
                }
            }
            let duplicateExtract = extracts.find(e => {
                if (e.settings.Name !== extract.settings.Name) {
                    return false;
                }
                if (e.location.position.x !== extract.location.position.x || e.location.position.z !== extract.location.position.z) {
                    return false;
                }
                return true;
            });
            if (duplicateExtract) {
                if (duplicateExtract.exfilType === 'ExfiltrationPoint') {
                    duplicateExtract.exfilType = 'SharedExfiltrationPoint';
                    return extracts;
                }
                extracts = extracts.filter(e => e !== duplicateExtract);
                extract.exfilType = 'SharedExfiltrationPoint';
            }
            extracts.push({
                ...extract,
                name: extract.settings.Name,
            });
            return extracts;
        }, []);
        mapDetails.zones = mapDetails.zones.filter(z => !excludedZones[map.Id]?.includes(z.id));
        
        mapDetails.locks = mapDetails.locks.map(l => {
            return {
                ...l,
                needsPower: mapDetails.no_power?.some(pow => {
                    if (pow.location.position.x !== l.location.position.x) {
                        return false;
                    }
                    if (pow.location.position.y !== l.location.position.y) {
                        return false;
                    }
                    if (pow.location.position.z !== l.location.position.z) {
                        return false;
                    }
                    return true;
                }),
            }
        });
        mapDetails.stationary_weapons = mapDetails.stationary_weapons?.map(sw => {
            sw.weapon_id = sw.weaponItemId;
            return sw;
        }) || [];
        mapDetails.quest_items = mapDetails.quest_items?.reduce((all, current) => {
            const p = current.location.position;
            if (p.x || p.y || p.z) {
                all.push(current);
            }
            return all;
        }, []) || [];
        mapDetails.path_destinations = mapDetails.path_destinations || [];
        return mapDetails;
    },
};

export default mapDetailsTools;