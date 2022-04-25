const fs = require('fs');
const path = require('path');

const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');

module.exports = async () => {
    const logger = new JobLogger('update-hideout');    
    try {
        const data = await tarkovChanges.areas();
        const en = await tarkovChanges.locale_en();
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
                levels: []
            };
            if (!station.enabled) {
                logger.warn(`Hideout station ${stationData.name} is disabled`);
                continue;
            }
            logger.log(`Processing ${stationData.name}`)
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
                    description: en.interface[`hideout_area_${station.type}_stage_${i}_description`],
                    traderRequirements: [],
                    stationLevelRequirements: [],
                    itemRequirements: [],
                    skillRequirements: []
                };
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
                        stageData.skillRequirements.push({
                            id: `${stationData.id}-${i}-${r}`,
                            name: req.skillName,
                            level: req.skillLevel
                        });
                    } else if (req.type === 'Area') {
                        if (req.requiredLevel < 1) {
                            logger.warn(`Skipping ${en.interface[`hideout_area_${req.areaType}_name`]} level ${req.requiredLevel} requirement for ${en.interface[`hideout_area_${station.type}_name`]} level ${i}`);
                            continue;
                        }
                        stageData.stationLevelRequirements.push({
                            id: `${stationData.id}-${i}-${r}`,
                            station_id: areasByType[req.areaType],
                            name: en.interface[`hideout_area_${req.areaType}_name`],
                            stationLevel: req.requiredLevel
                        });
                    } else if (req.type === 'TraderLoyalty') {
                        stageData.traderRequirements.push({
                            id: `${stationData.id}-${i}-${r}`,
                            trader_id: req.traderId,
                            name: en.trading[req.traderId].Nickname,
                            traderLevel: req.loyaltyLevel
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
        fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'hideout.json'), JSON.stringify(hideoutData, null, 4));
        const response = await cloudflare(`/values/HIDEOUT_DATA_V2`, 'PUT', JSON.stringify(hideoutData)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of HIDEOUT_DATA_V2');
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