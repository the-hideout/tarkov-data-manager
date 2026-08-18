import fs from 'node:fs';
import path from 'node:path';

import tarkovChanges from './tarkov-data-tarkov-changes.mjs';
import tarkovBot from './tarkov-bot.mjs';
import spt from './tarkov-data-spt.mjs';
import tarkovDevData from './tarkov-data-tarkov-dev.mjs';
import sp from './tarkov-data-sp.mjs';
import mData from './tarkov-data-md.mjs';
import dataOptions from './data-options.mjs';

const mainDataSource = sp;

let manualTranslations = {};
try {
    const langFiles = fs.readdirSync('./translations').filter(file => file.endsWith('.json'));
    for (const file of langFiles) {
        const langCode = file.split('.')[0];
        manualTranslations[langCode] = JSON.parse(fs.readFileSync(`./translations/${file}`));
    }
} catch (error) {
    console.error('Error parsing manual language file:', error);
}

function addManualTranslations(lang, langCode) {
    try {
        const legacyTranslation = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'locale', `${langCode}.json`)));
        lang = {
            ...legacyTranslation,
            ...lang,
        };
    } catch {}
    if (manualTranslations[langCode]) {
        lang = {
            ...lang,
            ...manualTranslations[langCode],
        };
    }
    return lang;
}

const cachePath = (filename) => {
    return path.join(import.meta.dirname, '..', 'cache', filename);   
}

const defaultOptions = dataOptions.default;

const addLocation = (obj) => {
    obj.location = {
        position: {
            x: obj.pos[0],
            y: obj.pos[1],
            z: obj.pos[2],
        },
    };
    if (obj.outline) {
        obj.location.outline = obj.outline?.reduce((points, point) => {
            if (!points.some(p => p[0] === point[0] && p[2] === point[2])) {
                points.push(point);
            }
            return points;
        }, []);
    }
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

const dataFunctions = {
    achievements: async (options = defaultOptions) => {
        return mainDataSource.achievements(options);
    },
    achievementStats: (options = defaultOptions) => {
        return mainDataSource.achievementStats(options);
    },
    areas: (options = defaultOptions) => {
        return mainDataSource.areas(options);
    },
    botInfo: (botKey, options = defaultOptions) => {
        return spt.botInfo(botKey, options);
    },
    botsInfo: async (options = defaultOptions) => {
        return sp.botRender(options);
    },
    botsHealth: async (options = defaultOptions) => {
        return sp.botsHealth();
    },
    botGroups: async (options = defaultOptions) => {
        return sp.botGroups();
    },
    crafts: (options = defaultOptions) => {
        return mainDataSource.crafts(options);
    },
    credits: (options = defaultOptions) => {
        return mainDataSource.credits(options);
    },
    customization: (options = defaultOptions) => {
        return mainDataSource.customization(options);
    },
    globals: (options = defaultOptions) => {
        return mainDataSource.globals(options);
    },
    handbook: (options = defaultOptions) => {
        if (options.gameMode === 'pvp-season') {
            //return sp.handbook(options);
            options.gameMode = 'regular';
        }
        return mainDataSource.handbook(options);
    },
    items: (options = defaultOptions) => {
        /*if (options.gameMode === 'pvp-season') {
            return sp.items(options);
        }*/
        return mainDataSource.items(options);
    },
    locale: async (lang = 'en', options = defaultOptions) => {
        if (lang === 'en') {
            return addManualTranslations(await mainDataSource.locale_en(options), lang);
        }
        //if (lang == 'ru') return tarkovBot.locale('ru', options);
        return addManualTranslations(await mData.locale(lang, options), lang);
    },
    locales: async (options = defaultOptions) => {
        const [en, others] = await Promise.all([
            mainDataSource.locale_en(options).then(localeEn => {
                return addManualTranslations(localeEn, 'en');
            }),
            //addManualTranslations(tarkovBot.locale('ru', options), 'ru'),
            mData.locales(options).then(async langs => {
                const mergedLangs = {};
                const langCodes = Object.keys(langs);
                for (const langCode of langCodes) {
                    mergedLangs[langCode] = addManualTranslations(langs[langCode], langCode);
                }
                return mergedLangs;
            }),
        ]);
        return {
            en,
            ...others
        };
    },
    locations: (options = defaultOptions) => {
        /*if (options.gameMode === 'pvp-season') {
            return sp.locations(options);
        }*/
        return mainDataSource.locations(options);
    },
    seasonalPerks: (options) => {
        return mainDataSource.seasonalPerks({...options, gameMode: 'pvp-season'});
    },
    storyChapters: (options = defaultOptions) => {
        /*if (options.gameMode === 'pvp-season') {
            return sp.storyChapters(options);
        }*/
        return mainDataSource.storyChapters(options);
    },
    tapeList: (options = defaultOptions) => {
        /*if (options.gameMode === 'pvp-season') {
            return sp.tapeList(options);
        }*/
        return mainDataSource.tapeList(options);
    },
    mapDetails: async (options = defaultOptions) => {
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
                /*{ // old Crash Site
                    name: 'Exit_E4_new',
                    requirements: {
                        status: 'Pending',
                    }
                }*/
            ]
        };
        const excludedZones = {
            RezervBase: [
                'fuel4',
            ],
        };
        const details = {};
        const [locations, items] = await Promise.all([
            dataFunctions.locations(),
            dataFunctions.items(),
        ]);
        const duplicateMaps = {
            'factory4_day': Object.values(locations).find(m => m.Id === 'factory4_night'),
            'laboratory': Object.values(locations).find(m => m.Id === 'laboratory_dark'),
        };
        const en = await dataFunctions.locale('en');
        for (const id in locations.locations) {
            const map = locations.locations[id];
            /*if (id !== '59fc81d786f774390775787e' && (!map.Enabled || map.Locked)) {
                continue;
            }*/
            if (!en[`${id} Name`]) {
                continue;
            }
            details[id] = {};
            try {
                const mapData = await tarkovDevData.mapData(map.Id, options).catch(error => {
                    if (error.message === '404 Not Found') {
                        return structuredClone(emptyData);
                    }
                });
                continue;
                details[id].extracts = mapData.exfils.reduce((extracts, extract) => {
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

                details[id].transits = mapData.transit_points.map(transit => addLocation(transit));

                details[id].doors = mapData.doors.map(door => addLocation(door));

                details[id].zones = mapData.quest_triggers.filter(z => !excludedZones[map.Id]?.includes(z.name)).map(zone => addLocation(zone));

                details[id].hazards = [
                    ...mapData.minefields.map(hazard => {
                        return {
                            ...hazard,
                            type: 'Minefield',
                        };
                    }),
                    ...mapData.mines_directional.map(hazard => {
                        return {
                            ...hazard,
                            type: 'Minefield',
                        };
                    }),
                    ...mapData.sniper_zones.map(hazard => {
                        return {
                            ...hazard,
                            type: 'SniperFiringZone',
                        };
                    }),
                ].map(hazard => addLocation(hazard));
                
                details[id].locks = mapData.doors.map(door => {
                    if (!door.key_id) {
                        return;
                    }
                    return door;
                    /*return {
                        ...door,
                        needsPower: details[id].no_power?.some(pow => {
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
                details[id].loot_points = mapData.loose_points.map(point => addLocation(point));
                details[id].loot_containers = [];
                details[id].stationary_weapons = mapData.stationary?.map(stationary => addLocation(stationary)) ?? [];

                details[id].switches = mapData.interaction_switches.map(sw => {

                });
                details[id].quest_items = mapData.loose_points.map(point => {
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
                details[id].spawns = mapData.spawn_points.map(spawn => addLocation(spawn));
                details[id].path_destinations = mapData.path_destinations || [];
            } catch (error) {
                if (error.code === 'ENOENT') {
                    details[id] = emptyData;
                    if (!map.Enabled && !map.Locked) {
                        console.warn(`No map details data for ${map.Id} ${id}`);
                    }
                    continue;
                }
                return Promise.reject(error);
            }
            for (const sourceId in duplicateMaps) {
                if (sourceId !== map.Id) {
                    continue;
                }
                const targetMap = duplicateMaps[sourceId];
                if (!targetMap) {
                    continue;
                }
                details[targetMap._Id] ??= structuredClone(details[id]);
            }
        }
        return details;
    },
    mapLoot: (options = defaultOptions) => {
        return spt.mapLoot(options);
    },
    prestige: (options = defaultOptions) => {
        return mainDataSource.prestige(options);
    },
    quests: async (options = defaultOptions) => {
        return tarkovDevData.quests(options);
    },
    questConfig: (options = defaultOptions) => {
        return spt.questConfig(options);
    },
    status: (options = defaultOptions) => {
        return tarkovDevData.status(options);
    },
    traders: (options = defaultOptions) => {
        /*if (options.gameMode === 'pvp-season') {
            return sp.traders(options);
        }*/
        return mainDataSource.traders(options);
    },
    traderAssorts: async (traderId, options = defaultOptions) => {
        return spt.traderAssorts(traderId, options);
    },
    traderQuestAssorts: async (traderId, options = defaultOptions) => {
        return spt.traderQuestAssorts(traderId, options);
    },
    downloadAll: (options = defaultOptions) => {
        /*if (options.gameMode === 'pvp-season') {
            return sp.downloadAll(options);
        }*/
        return mainDataSource.downloadAll(options);
    },
};

export default dataFunctions;
