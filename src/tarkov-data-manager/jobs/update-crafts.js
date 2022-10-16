const cloudflare = require('../modules/cloudflare');
//const christmasTreeCrafts = require('../public/data/christmas-tree-crafts.json');

const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');
const jobOutput = require('../modules/job-output');

module.exports = async function() {
    const logger = new JobLogger('update-crafts');
    try {
        logger.log('Loading json files...');
        const [items, json, en, areas, processedItems] = await Promise.all([
            tarkovChanges.items(),
            tarkovChanges.crafts(),
            tarkovChanges.locale_en(),
            jobOutput('update-hideout', './dumps/hideout_data.json', logger),
            jobOutput('update-item-cache', './dumps/item_data.json', logger),
        ]);
        const crafts = {
            updated: new Date(),
            data: [],
        };
        logger.log('Processing crafts...');
        for (const id in json) {
            const craft = json[id];
            let station = areas.find(area => area.areaType === craft.areaType);
            if (!station) {
                logger.warn(`${en.interface[`hideout_area_${craft.areaType}_name`]} is not an active station`);
                continue;
            }
            if (!en.templates[craft.endProduct]) {
                logger.warn(`No end product item with id ${craft.endProduct} found in locale_en.json`);
                continue;
            }
            if (!en.interface[`hideout_area_${craft.areaType}_name`]) {
                logger.warn(`No hideout station of type ${craft.areaType} found in locale_en.json`);
                continue;
            }
            if (!processedItems[craft.endProduct]) {
                logger.warn(`No end product item with id ${craft.endProduct} found in processed items`);
                continue;
            }
            const craftData = {
                id: id,
                requiredItems: [],
                rewardItems: [{
                    name: en.templates[craft.endProduct].Name,
                    item: craft.endProduct,
                    count: craft.count,
                    attributes: []
                }],
                station: station.id,
                station_id: station.id,
                sourceName: en.interface[`hideout_area_${craft.areaType}_name`],
                duration: craft.productionTime,
                requirements: []
            };
            let level = false;
            for (index in craft.requirements) {
                const req = craft.requirements[index];
                if (req.type === 'Area') {
                    //craftData.station = craftData.station + ' level '+req.requiredLevel;
                    craftData.requirements.push({
                        type: 'stationLevel',
                        value: req.requiredLevel
                    });
                    craftData.level = req.requiredLevel;
                    level = req.requiredLevel;
                } else if (req.type === 'Resource') {
                    if (!en.templates[req.templateId]) {
                        logger.warn(`No requirement resource with id ${req.templateId} found in locale_en.json`);
                        continue;
                    }
                    if (!items[req.templateId]) {
                        logger.warn(`No requirement resource with id ${req.templateId} found in items.json`);
                        continue;
                    }
                    if (!processedItems[req.templateId]) {
                        logger.warn(`No requirement resource with id ${req.templateId} found in processed items`);
                        continue;
                    }
                    craftData.requiredItems.push({
                        name: en.templates[req.templateId].Name,
                        item: req.templateId,
                        count: req.resource / items[req.templateId]._props.Resource,
                        attributes: []
                    });
                } else if (req.type === 'Item') {
                    if (!en.templates[req.templateId]) {
                        logger.warn(`No requirement item with id ${req.templateId} found in locale_en.json`);
                        continue;
                    }
                    const reqData = {
                        name: en.templates[req.templateId].Name,
                        item: req.templateId,
                        count: req.count,
                        attributes: []
                    };
                    if (req.isFunctional) {
                        reqData.attributes.push({
                            type: 'functional',
                            value: String(req.isFunctional)
                        })
                    }
                    craftData.requiredItems.push(reqData);
                } else if (req.type == 'Tool') {
                    if (!en.templates[req.templateId]) {
                        logger.warn(`No requirement tool with id ${req.templateId} found in locale_en.json`);
                        continue;
                    }
                    const reqData = {
                        name: en.templates[req.templateId].Name,
                        item: req.templateId,
                        count: 1,
                        attributes: []
                    };
                    reqData.attributes.push({
                        type: 'tool',
                        value: String(true)
                    });
                    craftData.requiredItems.push(reqData);
                }
            }
            if (!level) {
                //craftData.station = craftData.station + ' level 1';
                craftData.requirements.push({
                    type: 'stationLevel',
                    value: 1
                });
                craftData.level = 1;
            }
            craftData.source = `${en.interface[`hideout_area_${craft.areaType}_name`]} level ${craftData.level}`;
            crafts.data.push(craftData);
        }
        logger.log(`Processed ${Object.keys(json).length} crafts`);

        const response = await cloudflare.put('craft_data', JSON.stringify(crafts)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of craft_data');
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
};