import fs from 'node:fs';
import path from 'node:path';

import tarkovChanges from './tarkov-changes.mjs';
import tarkovBot from './tarkov-bot.mjs';
import spt from './tarkov-spt.mjs';
import tarkovDevData from './tarkov-dev-data.mjs';

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

async function addManualTranslations(lang, langCode) {
    lang = await lang;
    if (!manualTranslations[langCode]) {
        return lang;
    }
    return {
        ...manualTranslations[langCode],
        ...lang,
    };
}

const cachePath = (filename) => {
    return path.join(import.meta.dirname, '..', 'cache', filename);   
}

const dataFunctions = {
    achievements: async (download = false, sessionMode = 'regular') => {
        return tarkovDevData.achievements(download, sessionMode = 'regular');
    },
    achievementStats: (download = false, sessionMode = 'regular') => {
        return tarkovDevData.achievementStats(download, sessionMode = 'regular');
    },
    areas: (download = false) => {
        return tarkovChanges.areas(download);
    },
    botInfo: (botKey, download = false) => {
        return spt.botInfo(botKey, download);
    },
    botsInfo: async (download = true) => {
        return spt.botsInfo(download);
    },
    crafts: (download = false) => {
        return tarkovChanges.crafts(download);
    },
    credits: (download = false) => {
        return tarkovChanges.credits(download);
    },
    globals: (download = false) => {
        return tarkovChanges.globals(download);
    },
    handbook: (download = false) => {
        return spt.handbook(download);
    },
    items: (download = false) => {
        return tarkovChanges.items(download);
    },
    locale: (lang = 'en', download = false) => {
        if (lang == 'en') return addManualTranslations(tarkovChanges.locale_en(download), lang);
        //if (lang == 'ru') return tarkovBot.locale('ru', download);
        return addManualTranslations(spt.locale(lang, download), lang);
    },
    locales: async (download = false) => {
        const [en, others] = await Promise.all([
            addManualTranslations(tarkovChanges.locale_en(download), 'en'),
            //addManualTranslations(tarkovBot.locale('ru', download), 'ru'),
            spt.locales(download).then(async langs => {
                const mergedLangs = {};
                const langCodes = Object.keys(langs);
                for (const langCode of langCodes) {
                    mergedLangs[langCode] = await addManualTranslations(langs[langCode], langCode);
                }
                return mergedLangs;
            }),
        ]);
        return {
            en: en,
            ...others
        }
    },
    locations: (download = false) => {
        return tarkovChanges.locations(download);
    },
    mapDetails: async () => {
        const emptyData = {
            extracts: [],
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
            if (id !== '59fc81d786f774390775787e' && (!map.Enabled || map.Locked)) {
                continue;
            }
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
            } catch (error) {
                if (error.code === 'ENOENT') {
                    details[id] = emptyData;
                    continue;
                }
                return Promise.reject(error);
            }
        }
        return details;
    },
    mapLoot: (download = false) => {
        return spt.mapLoot(download);
    },
    quests: async (download = false) => {
        const mainQuests = await spt.quests(download);
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
    questConfig: (download = false) => {
        return spt.questConfig(download);
    },
    status: (download = false) => {
        return tarkovDevData.status(download);
    },
    traders: (download = false) => {
        return tarkovChanges.traders(download);
    },
    traderAssorts: async (traderId, download = false) => {
        return spt.traderAssorts(traderId, download);
    },
    traderQuestAssorts: async (traderId, download = false) => {
        return spt.traderQuestAssorts(traderId, download);
    },
};

export default dataFunctions;
