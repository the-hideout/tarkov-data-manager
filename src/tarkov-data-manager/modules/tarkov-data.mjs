import fs from 'node:fs';
import path from 'node:path';

import tarkovChanges from './tarkov-changes.mjs';
import tarkovBot from './tarkov-bot.mjs';
import spt from './tarkov-spt.mjs';
import tarkovDevData from './tarkov-dev-data.mjs';
import dataOptions from './data-options.mjs';

const mainDataSource = tarkovChanges;

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
    if (!manualTranslations[langCode]) {
        return lang;
    }
    return {
        ...lang,
        ...manualTranslations[langCode],
    };
}

const cachePath = (filename) => {
    return path.join(import.meta.dirname, '..', 'cache', filename);   
}

const defaultOptions = dataOptions.default;

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
        return spt.botsInfo(options);
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
        return mainDataSource.handbook(options);
    },
    items: (options = defaultOptions) => {
        return mainDataSource.items(options);
    },
    locale: async (lang = 'en', options = defaultOptions) => {
        if (lang === 'en') {
            return addManualTranslations(await mainDataSource.locale_en(options), lang);
        }
        //if (lang == 'ru') return tarkovBot.locale('ru', options);
        return addManualTranslations(await spt.locale(lang, options), lang);
    },
    locales: async (options = defaultOptions) => {
        const [en, others] = await Promise.all([
            mainDataSource.locale_en(options).then(localeEn => {
                return addManualTranslations(localeEn, 'en');
            }),
            //addManualTranslations(tarkovBot.locale('ru', options), 'ru'),
            spt.locales(options).then(async langs => {
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
        return mainDataSource.locations(options);
    },
    mapDetails: async () => {
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
        const details = {};
        const locations = await dataFunctions.locations();
        const en = await dataFunctions.locale('en');
        for (const id in locations.locations) {
            const map = locations.locations[id];
            /*if (id !== '59fc81d786f774390775787e' && (!map.Enabled || map.Locked)) {
                continue;
            }*/
            if (!en[`${id} Name`]) {
                continue;
            }
            try {
                details[id] = JSON.parse(fs.readFileSync(`./cache/${map.Id}.json`));
                details[id].extracts = details[id].extracts.reduce((extracts, extract) => {
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
                    extracts.push(extract);
                    return extracts;
                }, []);
                details[id].zones = details[id].zones.filter(z => !excludedZones[map.Id]?.includes(z.id));
                
                details[id].locks = details[id].locks.map(l => {
                    return {
                        ...l,
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
                    }
                });
                details[id].stationary_weapons = details[id].stationary_weapons || [];
                details[id].quest_items = details[id].quest_items?.reduce((all, current) => {
                    const p = current.location.position;
                    if (p.x || p.y || p.z) {
                        all.push(current);
                    }
                    return all;
                }, []) || [];
                details[id].path_destinations = details[id].path_destinations || [];
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
        const mainQuests = await spt.quests(options);
        try {
            const partialQuests = JSON.parse(fs.readFileSync(cachePath('quests_partial.json')));
            for (const quest of partialQuests) {
                if (mainQuests[quest._id]) {
                    continue;
                }
                /*quest.conditions.AvailableForFinish = quest.conditions.AvailableForFinish.map(obj => {
                    const newObj = {
                        _props: {
                            ...obj,
                            type: obj.type || obj.conditionType,
                        },
                        _parent: obj.conditionType,
                    };
                    if (newObj._props.counter?.conditions) {
                        newObj._props.counter.conditions = newObj._props.counter.conditions.map(cond => {
                            return {
                                _parent: cond.conditionType,
                                _props: {...cond},
                            };
                        });
                    }
                    return newObj;
                });
                quest.conditions.AvailableForStart = quest.conditions.AvailableForStart.map(cond => {
                    return {
                        _parent: cond.conditionType,
                        _props: {
                            ...cond,
                        },
                    }
                });*/
                mainQuests[quest._id] = quest;
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                return Promise.reject(error);
            }
        }
        return mainQuests;
    },
    questConfig: (options = defaultOptions) => {
        return spt.questConfig(options);
    },
    status: (options = defaultOptions) => {
        return tarkovDevData.status(options);
    },
    traders: (options = defaultOptions) => {
        return mainDataSource.traders(options);
    },
    traderAssorts: async (traderId, options = defaultOptions) => {
        return spt.traderAssorts(traderId, options);
    },
    traderQuestAssorts: async (traderId, options = defaultOptions) => {
        return spt.traderQuestAssorts(traderId, options);
    },
    downloadAll: (options = defaultOptions) => {
        return mainDataSource.downloadAll(options);
    },
};

export default dataFunctions;
