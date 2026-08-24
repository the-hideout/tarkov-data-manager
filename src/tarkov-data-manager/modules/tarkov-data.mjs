import fs from 'node:fs';
import path from 'node:path';

import tarkovChanges from './tarkov-data-tarkov-changes.mjs';
import tarkovBot from './tarkov-bot.mjs';
import spt from './tarkov-data-spt.mjs';
import tarkovDevData from './tarkov-data-tarkov-dev.mjs';
import sp from './tarkov-data-sp.mjs';
import mData from './tarkov-data-md.mjs';
import dataOptions from './data-options.mjs';
import mapDetailsTools from './tarkov-data-map-details-tools.mjs';

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
        const details = {};
        const [locations, items, en] = await Promise.all([
            dataFunctions.locations(),
            dataFunctions.items(),
            dataFunctions.locale('en'),
        ]);
        return mapDetailsTools.getAllMapDetails(locations, items, en, options);
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
