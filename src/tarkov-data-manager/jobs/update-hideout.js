const got = require('got');

const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovData = require('../modules/tarkov-data');
const hideoutLegacy = require('./update-hideout-legacy');
const normalizeName = require('../modules/normalize-name');
const { setLocales, getTranslations } = require('../modules/get-translation');

module.exports = async () => {
    const logger = new JobLogger('update-hideout');    
    try {
        const [data, locales, tdHideout] = await Promise.all([
            tarkovData.areas(),
            tarkovData.locales(),
            got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/hideout.json', {
                responseType: 'json',
                resolveBodyOnly: true,
            })
        ]);
        const en = locales.en;
        setLocales(locales);
        const hideoutData = {
            updated: new Date(),
            data: [],
        };
        const areasByType = {};
        for (const stationId in data) {
            areasByType[data[stationId].type] = stationId;
        }
        for (const stationId in data) {
            // skip christmas tree
            if (stationId === '5df8a81f8f77747fcf5f5702') continue;
            
            const station = data[stationId];
            if (!en.interface[`hideout_area_${station.type}_name`]) {
                logger.warn(`No hideout station of type ${station.type} found in locale_en.json`);
                continue;
            }
            const stationData = {
                id: station._id,
                name: en.interface[`hideout_area_${station.type}_name`],
                normalizedName: normalizeName(en.interface[`hideout_area_${station.type}_name`]),
                areaType: station.type,
                levels: [],
                locale: getTranslations({name: ['interface', `hideout_area_${station.type}_name`]}, logger),
            };
            if (!station.enabled) {
                logger.warn(`Hideout station ${stationData.name} is disabled`);
                continue;
            }
            logger.log(`Processing ${stationData.name}`);
            for (const tdStation of tdHideout.stations) {
                if (tdStation.locales.en.toLowerCase() === stationData.name.toLowerCase()) {
                    stationData.tarkovDataId = tdStation.id;
                    break;
                }
            }
            if (typeof stationData.tarkovDataId === 'undefined') {
                logger.warn(`Could not find TarkovData id for ${stationData.name}`);
            }
            for (let i = 1; i < Object.keys(station.stages).length; i++) {
                if (!station.stages[String(i)]) {
                    logger.warn(`No stage found for ${stationData.name} level ${i}`);
                    continue;
                }
                if (!en.interface[`hideout_area_${station.type}_stage_${i}_description`]) {
                    logger.warn(`No stage ${i} description found for ${stationData.name}`);
                }
                const stage = station.stages[String(i)];
                const stageData = {
                    id: `${stationData.id}-${i}`,
                    level: i,
                    constructionTime: stage.constructionTime,
                    traderRequirements: [],
                    stationLevelRequirements: [],
                    itemRequirements: [],
                    skillRequirements: [],
                    locale: getTranslations({description: ['interface', `hideout_area_${station.type}_stage_${i}_description`]}),
                };
                for (const tdModule of tdHideout.modules) {
                    if (tdModule.stationId === stationData.tarkovDataId && tdModule.level === stageData.level) {
                        stageData.tarkovDataId = tdModule.id;
                        break;
                    }
                }
                if (typeof stageData.tarkovDataId === 'undefined') {
                    logger.warn(`Could not find tarkovData id for ${stationData.name} level ${stageData.level}`);
                }
                for (let r = 0; r < stage.requirements.length; r++) {
                    const req = stage.requirements[r];
                    if (req.type === 'Item') {
                        stageData.itemRequirements.push({
                            id: `${stationData.id}-${i}-${r}`,
                            item: req.templateId,
                            name: en.templates[req.templateId].Name,
                            count: req.count,
                            //functional: req.isFunctional
                        });
                    } else if (req.type === 'Skill') {
                        const skillReq = {
                            id: `${stationData.id}-${i}-${r}`,
                            name: en.interface[req.skillName] || req.skillName,
                            level: req.skillLevel,
                            locale: getTranslations({name: ['interface', req.skillName]}),
                        };
                        stageData.skillRequirements.push(skillReq);
                    } else if (req.type === 'Area') {
                        if (req.requiredLevel < 1) {
                            logger.warn(`Skipping ${en.interface[`hideout_area_${req.areaType}_name`]} level ${req.requiredLevel} requirement for ${en.interface[`hideout_area_${station.type}_name`]} level ${i}`);
                            continue;
                        }
                        stageData.stationLevelRequirements.push({
                            id: `${stationData.id}-${i}-${r}`,
                            station: areasByType[req.areaType],
                            name: en.interface[`hideout_area_${req.areaType}_name`],
                            level: req.requiredLevel
                        });
                    } else if (req.type === 'TraderLoyalty') {
                        stageData.traderRequirements.push({
                            id: `${stationData.id}-${i}-${r}`,
                            trader_id: req.traderId,
                            name: en.trading[req.traderId].Nickname,
                            level: req.loyaltyLevel
                        });
                    } else {
                        logger.warn(`Unrecognized requirement type ${req.type} for ${stationData.name} ${i}`);
                        continue;
                    }
                }
                stationData.levels.push(stageData);
            }
            hideoutData.data.push(stationData);
        }

        hideoutData.legacy = await hideoutLegacy(tdHideout, logger);

        const response = await cloudflare.put('hideout_data', JSON.stringify(hideoutData)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of hideout_data');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                logger.error(response.messages[i]);
            }
        }
        logger.success(`Processed ${hideoutData.data.length} hideout stations`);
    } catch (error){
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error
        });
    }
    logger.end();
}