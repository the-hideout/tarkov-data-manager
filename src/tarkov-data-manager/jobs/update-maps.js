const fs = require('fs');
const path = require('path');

const got = require('got');

const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');
//const {query, jobComplete} = require('../modules/db-connection');

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

module.exports = async function() {
    const logger = new JobLogger('update-maps');
    try {
        logger.log('Getting en from Tarkov-Changes...');
        const en = await tarkovChanges.locale_en();
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
                ...tdMaps[index]
            };
            mapData.tarkovDataId = mapData.id;
            mapData.name = mapData.locale.en;
            const dayDuration = mapData.raidDuration.day;
            const nightDuration = mapData.raidDuration.night;
            if (mapData.id === 0) {
                const nfData = {
                    ...mapData
                };
                nfData.name = 'Night Factory';
                nfData.locale.en = 'Night Factory';
                nfData.raidDuration = nightDuration;
                nfData.id = '59fc81d786f774390775787e';
                maps.data.push(nfData);
            }
            mapData.id = idMap[mapData.id];
            mapData.raidDuration = dayDuration;
            maps.data.push(mapData);
        }
        logger.log(`Processed ${maps.data.length} maps`);
    
        fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'maps.json'), JSON.stringify(maps, null, 4));

        const response = await cloudflare(`/values/MAP_DATA`, 'PUT', JSON.stringify(maps)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of MAP_DATA');
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