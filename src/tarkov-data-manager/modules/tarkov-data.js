const fs = require('fs');

const tarkovChanges = require('./tarkov-changes');
const tarkovBot = require('./tarkov-bot');
const spt = require('./tarkov-spt');
const normalizeName = require('./normalize-name');

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
            loot_points: [],
            loot_containers: [],
        };
        const excludedExtracts = [
            'Gate 2'
        ];
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
            let normalizedName = normalizeName(en[`${id} Name`]);
            if (id === '59fc81d786f774390775787e') {
                normalizedName = normalizeName(en.factory4_night);
            }
            try {
                details[id] = JSON.parse(fs.readFileSync(`./cache/${normalizedName}.json`));
                details[id].extracts = details[id].extracts.reduce((extracts, extract) => {
                    const sharedExtract = extracts.find(e => {
                        if (e.settings.Name !== extract.settings.Name) {
                            return false;
                        }
                        if (e.position.center.x !== extract.position.center.x || e.position.center.z !== extract.position.center.z) {
                            return false;
                        }
                        return true;
                    });
                    if (sharedExtract) {
                        sharedExtract.exfilType = 'SharedExfiltrationPoint';
                    } else if (!excludedExtracts.includes(extract.settings.Name)) {
                        extracts.push(extract);
                    }
                    return extracts;
                }, []);
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
    quests: (download = false) => {
        return spt.quests(download);
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
