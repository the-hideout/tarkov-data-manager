const tarkovChanges = require('./tarkov-changes');
const tarkovBot = require('./tarkov-bot');
const spt = require('./tarkov-spt');

module.exports = {
    areas: (download = false) => {
        return tarkovChanges.areas(download);
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
        if (lang == 'en') return tarkovChanges.locale_en(download);
        if (lang == 'ru') return tarkovBot.dictionary(download, `locale_ru.json`, lang);
        return spt.locale(lang, download);
    },
    locales: async (download = false) => {
        return {
            en: await tarkovChanges.locale_en(download),
            ru: await tarkovBot.dictionary(download, 'locale_ru.json', 'ru'),
            ...await spt.locales(download)
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
