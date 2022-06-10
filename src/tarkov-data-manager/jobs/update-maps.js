const got = require('got');
const cheerio = require('cheerio');

const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');

const mapNames = {
    '59fc81d786f774390775787e': 'Night Factory',
    '55f2d3fd4bdc2d5f408b4567': 'Factory',
    '5704e4dad2720bb55b8b4567': 'Lighthouse',
    '56f40101d2720b2a4d8b45d6': 'Customs',
    '5704e5fad2720bc05b8b4567': 'Reserve',
    '5714dbc024597771384a510d': 'Interchange',
    '5704e554d2720bac5b8b456e': 'Shoreline',
    '5704e3c2d2720bac5b8b4567': 'Woods',
    '5b0fc42d86f7744a585f9105': 'The Lab'
};

const idMap = {
    0: '55f2d3fd4bdc2d5f408b4567',
    1: '56f40101d2720b2a4d8b45d6',
    2: '5704e3c2d2720bac5b8b4567',
    3: '5704e554d2720bac5b8b456e',
    4: '5714dbc024597771384a510d',
    5: '5b0fc42d86f7744a585f9105',
    6: '5704e5fad2720bc05b8b4567',
    7: '5704e4dad2720bb55b8b4567',
};

const enemyMap = {
    'Cultists': 'ScavRole/Sectant',
    'Glukhar': 'QuestCondition/Elimination/Kill/BotRole/bossGluhar',
    'Killa': 'QuestCondition/Elimination/Kill/BotRole/bossKilla',
    'Raiders': 'ScavRole/PmcBot',
    'Reshala': 'QuestCondition/Elimination/Kill/BotRole/bossBully',
    'Rogues': 'ScavRole/ExUsec',
    'Sanitar': 'QuestCondition/Elimination/Kill/BotRole/bossSanitar',
    'Scavs': 'QuestCondition/Elimination/Kill/Target/Savage',
    'Shturman': 'QuestCondition/Elimination/Kill/BotRole/bossKojaniy',
    'Tagilla': 'QuestCondition/Elimination/Kill/BotRole/bossTagilla'
};

const enemySubs = {
    '???': 'Cultists'
}

const getWikiInfo = async (url) => {
    const info = {};
    const response = await got(url);
    const $ = cheerio.load(response.body);
    const group = $('table.va-infobox-group td').each((index, element) => {
        if ($(element).text() === 'Players') {
            info.players = $('table.va-infobox-group td').eq(index+2).text();
        }
    });
    return info;
};

module.exports = async function() {
    const logger = new JobLogger('update-maps');
    try {
        logger.log('Getting en from Tarkov-Changes...');
        const en = await tarkovChanges.locale_en();
        const locales = await tarkovChanges.locales();
        const maps = {
            updated: new Date(),
            data: [],
        };
        logger.log('Downloading TarkovData maps.json')
        const tdMaps = (await got('https://github.com/TarkovTracker/tarkovdata/raw/master/maps.json', {
            responseType: 'json',
        })).body;
        logger.log('Processing maps...');
        for (const index in tdMaps) {
            const mapData = {
                ...tdMaps[index],
                locale: {}
            };
            mapData.tarkovDataId = mapData.id;
            mapData.id = idMap[mapData.id];
            mapData.name = locales.en.locations[mapData.id].Name;//mapData.locale.en;
            const dayDuration = mapData.raidDuration.day;
            const nightDuration = mapData.raidDuration.night;
            const wikiInfo = await getWikiInfo(mapData.wiki);
            mapData.players = wikiInfo.players;
            if (mapData.id === '55f2d3fd4bdc2d5f408b4567') {
                const nfData = {
                    ...mapData,
                    locale: {}
                };
                nfData.id = '59fc81d786f774390775787e';
                nfData.name = 'Night Factory';
                //nfData.name = locales.en.locations[nfData.id].Name;
                //nfData.locale.en = 'Night Factory';
                nfData.raidDuration = nightDuration;
                maps.data.push(nfData);
                mapData.enemies = mapData.enemies.filter(enemy => {
                    return enemy !== 'Cultists';
                });
            }
            mapData.raidDuration = dayDuration;
            maps.data.push(mapData);
        }
        for (const map of maps.data) {
            for (const code in locales) {
                const lang = locales[code];
                let mapName = lang.locations[map.id].Name;
                if (map.id === '59fc81d786f774390775787e' && lang.interface.factory4_night) {
                    mapName = lang.interface.factory4_night;
                }
                const enemies = map.enemies.map(enemy => {
                    if (!lang.interface[enemyMap[enemy]]) return enemy;
                    let newName = lang.interface[enemyMap[enemy]];
                    if (enemySubs[newName]) return enemySubs[newName];
                    return newName;
                });
                map.locale[code] = {
                    name: mapName,
                    enemies: enemies
                };
            }
        }
        logger.log(`Processed ${maps.data.length} maps`);

        const response = await cloudflare('map_data', 'PUT', JSON.stringify(maps)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of map_data');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                logger.error(response.messages[i]);
            }
        }
        // Possibility to POST to a Discord webhook here with cron status details
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
    //await jobComplete();
};