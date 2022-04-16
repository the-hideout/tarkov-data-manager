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
        for (const station of data) {
            areasByType[station.type] = station._id;
        }
        for (const station of data) {
            if (!en.interface[`hideout_area_${station.type}_name`]) {
                logger.warn(`No hideout station of type ${station.type} found in locale_en.json`);
                continue;
            }
            const stationData = {
                id: station._id,
                name: en.interface[`hideout_area_${station.type}_name`],
                stages: []
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
                    level: i,
                    constructionTime: stage.constructionTime,
                    description: en.interface[`hideout_area_${station.type}_stage_${i}_description`],
                    traderRequirements: [],
                    moduleRequirements: [],
                    itemRequirements: [],
                    skillRequirements: []
                };
                for (const req of stage.requirements) {
                    if (req.type === 'Item') {
                        stageData.itemRequirements.push({
                            id: req.templateId,
                            name: en.templates[req.templateId].Name,
                            count: req.count,
                            //functional: req.isFunctional
                        });
                    } else if (req.type === 'Skill') {
                        stageData.skillRequirements.push({
                            name: req.skillname,
                            level: req.skillLevel
                        });
                    } else if (req.type === 'Area') {
                        stageData.moduleRequirements.push({
                            id: areasByType[req.areaType],
                            name: en.interface[`hideout_area_${req.areaType}_name`],
                            level: req.requiredLevel
                        });
                    } else if (req.type === 'TraderLoyalty') {
                        stageData.traderRequirements.push({
                            id: req.traderId,
                            name: en.trading[req.traderId].Nickname,
                            level: req.loyaltyLevel
                        });
                    } else {
                        logger.warn(`Unrecognized requirement type ${req.type} for ${stationData.name} ${i}`);
                        continue;
                    }
                }
                stationData.stages.push(stageData);
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
            message: error.toString()
        });
    }
    logger.end();
}