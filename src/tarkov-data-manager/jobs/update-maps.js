const got = require('got');
const cheerio = require('cheerio');

const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');
const normalizeName = require('../modules/normalize-name');
const mapQueueTimes = require('../modules/map-queue-times');
const { setLocales, getTranslations } = require('../modules/get-translation');

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
    '55f2d3fd4bdc2d5f408b4567': 0,
    '59fc81d786f774390775787e': 0,
    '56f40101d2720b2a4d8b45d6': 1,
    '5704e3c2d2720bac5b8b4567': 2,
    '5704e554d2720bac5b8b456e': 3,
    '5714dbc024597771384a510d': 4,
    '5b0fc42d86f7744a585f9105': 5,
    '5704e5fad2720bc05b8b4567': 6,
    '5704e4dad2720bb55b8b4567': 7,
};

const enemyMap = {
    'bossGluhar': 'QuestCondition/Elimination/Kill/BotRole/bossGluhar',
    'followerGluharScout': 'ScavRole/Follower',
    'followerGluharAssault': 'ScavRole/Follower',
    'followerGluharSecurity': 'ScavRole/Follower',
    'bossKilla': 'QuestCondition/Elimination/Kill/BotRole/bossKilla',
    'pmcBot': 'ScavRole/PmcBot',
    'bossBully': 'QuestCondition/Elimination/Kill/BotRole/bossBully',
    'followerBully': 'ScavRole/Follower',
    'exUsec': 'ScavRole/ExUsec',
    'bossSanitar': 'QuestCondition/Elimination/Kill/BotRole/bossSanitar',
    'followerSanitar': 'ScavRole/Follower',
    'scavs': 'QuestCondition/Elimination/Kill/Target/Savage',
    'sniper': 'ScavRole/Marksman',
    'sectantPriest': 'QuestCondition/Elimination/Kill/BotRole/sectantPriest',
    'sectantWarrior': 'QuestCondition/Elimination/Kill/BotRole/cursedAssault',
    'bossKojaniy': 'QuestCondition/Elimination/Kill/BotRole/bossKojaniy',
    'followerKojaniy': 'ScavRole/Follower',
    'bossTagilla': 'QuestCondition/Elimination/Kill/BotRole/bossTagilla',
    'followerTagilla': 'QuestCondition/Elimination/Kill/BotRole/bossTagilla'
};

const manualNames = {
    'bossKnight': 'Death Knight',
    'followerBigPipe': 'Big Pipe',
    'followerBirdEye': 'Birdeye'
};

const triggers = {
    '5704e5fad2720bc05b8b4567' : {
        'autoId_00000_D2_LEVER': 'D-2 Power Switch',
        'autoId_00632_EXFIL': 'Bunker Hermetic Door Power Switch'
    }
};

let locales;

const getEnemyName = (enemy, lang) => {
    if (enemyMap[enemy]) {
        if (lang.interface[enemyMap[enemy]]) {
            return lang.interface[enemyMap[enemy]];
        }
        return locales.en.interface[enemyMap[enemy]];
    } else if (manualNames[enemy]) {
        return manualNames[enemy];
    }
    return enemy;
};

const getChances = (input, nameLabel = 'name', labelInt = false) => {
    const optionCount = {};
    const options = input.split(',').map(option => {
        if (labelInt) option = parseInt(option);
        if (typeof optionCount[option] === 'undefined') optionCount[option] = 0;
        optionCount[option]++;
        return option;
    });
    const chances = [];
    for (const option in optionCount) {
        const chance = {
            chance: Math.round((optionCount[option] / options.length) * 100) / 100
        };
        chance[nameLabel] = labelInt ? parseInt(option) : option;
        chances.push(chance);
    }
    return chances;
}

module.exports = async function() {
    const logger = new JobLogger('update-maps');
    try {
        logger.log('Getting data from Tarkov-Changes...');
        locales = await tarkovChanges.locales();
        setLocales(locales);
        const locations = await tarkovChanges.locations();
        const maps = {
            updated: new Date(),
            data: [],
        };
        logger.log('Processing maps...');
        for (const id in locations.locations) {
            const map = locations.locations[id];
            if (id !== '59fc81d786f774390775787e' && (!map.Enabled || map.Locked)) continue;
            const mapData = {
                id: id,
                tarkovDataId: null,
                name: locales.en.locations[id].Name,
                normalizedName: normalizeName(locales.en.locations[id].Name),
                nameId: map.Id,
                description: locales.en.locations[id].Description,
                wiki: 'https://escapefromtarkov.fandom.com/wiki/'+locales.en.locations[id].Name.replace(/ /g, '_'),
                enemies: [],
                raidDuration: map.EscapeTimeLimit,
                players: map.MinPlayers+'-'+map.MaxPlayers,
                bosses: [],
                locale: {}
            };
            if (typeof idMap[id] !== 'undefined') mapData.tarkovDataId = idMap[id];
            const enemySet = new Set();
            for (const wave of map.waves) {
                if (wave.WildSpawnType === 'assault') {
                    enemySet.add('scavs');
                } else if (wave.WildSpawnType === 'marksman') {
                    enemySet.add('sniper');
                }
            }
            for (const spawn of map.BossLocationSpawn) {
                enemySet.add(spawn.BossName);
                const bossData = {
                    name: spawn.BossName,
                    normalizedName: normalizeName(getEnemyName(spawn.BossName, locales.en)),
                    spawnChance: parseInt(spawn.BossChance) / 100,
                    spawnLocations: [],
                    escorts: [],
                    supports: [],
                    spawnTime: spawn.Time,
                    spawnTimeRandom: spawn.RandomTimeSpawn,
                    spawnTrigger: null,
                    locale: {}
                };
                const locationCount = {};
                const locations = spawn.BossZone.split(',').map(zone => {
                    let locationName = zone.replace(/Zone_?/, '').replace(/Bot/, '');
                    if (!locationName) locationName = 'Anywhere';
                    if (typeof locationCount[locationName] === 'undefined') locationCount[locationName] = 0;
                    locationCount[locationName]++;
                    return locationName;
                });
                for (const locationName in locationCount) {
                    bossData.spawnLocations.push({
                        name: locationName,
                        chance: Math.round((locationCount[locationName] / locations.length) * 100) / 100
                    });
                }
                if (spawn.BossEscortAmount !== '0') {
                    if (enemyMap[spawn.BossEscortType] || manualNames[spawn.BossEscortType]) {
                        enemySet.add(spawn.BossEscortType);
                        bossData.escorts.push({
                            name: spawn.BossEscortType,
                            normalizedName: normalizeName(getEnemyName(spawn.BossEscortType, locales.en)),
                            amount: getChances(spawn.BossEscortAmount, 'count', true), 
                            locale: {}
                        });
                    }
                }
                if (spawn.Supports) {
                    for (const support of spawn.Supports) {
                        if (support.BossEscortAmount === '0') continue;
                        if (enemyMap[support.BossEscortType] || manualNames[support.BossEscortType]) {
                            enemySet.add(support.BossEscortType);
                            bossData.escorts.push({
                                name: support.BossEscortType,
                                normalizedName: normalizeName(getEnemyName(support.BossEscortType, locales.en)),
                                amount: getChances(support.BossEscortAmount, 'count', true), 
                                locale: {}
                            });
                        }
                    }
                }

                if (spawn.TriggerId && triggers[id]) {
                    if (triggers[id][spawn.TriggerId]) {
                        bossData.spawnTrigger = triggers[id][spawn.TriggerId];
                    } else if (spawn.TriggerId.includes('EXFIL')) {
                        bossData.spawnTrigger = 'Exfil Activation';
                    }
                }
                bossData.locale = getTranslations({
                    name: lang => {
                        return getEnemyName(bossData.name, lang);
                    }
                }, logger);
                for (const escort of bossData.escorts) {
                    escort.locale = getTranslations({
                        name: lang => {
                            return getEnemyName(escort.name, lang);
                        }
                    }, logger);
                }
                mapData.bosses.push(bossData);
            }
            mapData.enemies = [...enemySet];
            mapData.locale = getTranslations({
                name: lang => {
                    if (id === '59fc81d786f774390775787e' && lang.interface.factory4_night) {
                        return lang.interface.factory4_night;
                    }
                    return lang.locations[id].Name;
                },
                description: ['locations', id, 'Description'],
                enemies: lang => {
                    const enemies = new Set(mapData.enemies.map(enemy => {
                        return getEnemyName(enemy, lang);
                    }));
                    return [...enemies];
                }
            }, logger);
            mapData.name = mapData.locale.en.name;
            mapData.normalizedName = normalizeName(mapData.name);
            maps.data.push(mapData);
        }

        //const queueTimes = await mapQueueTimes(maps.data, logger);
        maps.data = maps.data.sort((a, b) => a.name.localeCompare(b.name)).map(map => {
            return {
                ...map,
                //queueTimes: queueTimes[map.id]
            };
        });

        logger.log(`Processed ${maps.data.length} maps`);

        const response = await cloudflare.put('map_data', JSON.stringify(maps)).catch(error => {
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