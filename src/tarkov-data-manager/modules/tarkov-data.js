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
        //if (lang == 'en') return tarkovChanges.locale_en(download);
        //if (lang == 'ru') return tarkovBot.locale('ru', download);
        return spt.locale(lang, download);
    },
    locales: async (download = false) => {
        const [en, ru, others] = await Promise.all([
            tarkovChanges.locale_en(download),
            tarkovBot.locale('ru', download),
            spt.locales(download),
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
