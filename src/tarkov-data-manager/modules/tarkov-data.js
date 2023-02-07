const fs = require('fs');

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

module.exports = {
    areas: (download = false) => {
        return tarkovChanges.areas(download);
    },
    botInfo: (botKey, download = true) => {
        return spt.botInfo(botKey, download);
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
        const [en, ru, others] = await Promise.all([
            addManualTranslations(tarkovChanges.locale_en(download), 'en'),
            addManualTranslations(tarkovBot.locale('ru', download), 'ru'),
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
            ru: ru,
            ...others
        }
    },
    locations: (download = false) => {
        return tarkovChanges.locations(download);
    },
    quests: (download = false) => {
        return spt.quests(download);
    },
    traders: (download = false) => {
        return tarkovChanges.traders(download);
    },
};
