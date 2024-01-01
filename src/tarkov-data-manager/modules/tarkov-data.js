const fs = require('fs');
const path = require('path');

const tarkovChanges = require('./tarkov-changes');
const tarkovBot = require('./tarkov-bot');
const spt = require('./tarkov-spt');

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
    return path.join(__dirname, '..', 'cache', filename);   
}

const dataFunctions = {
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
                mergedLangs = {};
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
        };
        const excludedExtracts = {
            Shoreline: [
                'Alpinist'
            ],
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
                    if (excludedExtracts[map.Id]?.includes(extract.settings.Name)) {
                        return extracts;
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
                quest.conditions.AvailableForFinish = quest.conditions.AvailableForFinish.map(obj => {
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

module.exports = dataFunctions;
