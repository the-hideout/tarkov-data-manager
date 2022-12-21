const cloudflare = require('../modules/cloudflare');
//const christmasTreeCrafts = require('../public/data/christmas-tree-crafts.json');

const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovData = require('../modules/tarkov-data');
const jobOutput = require('../modules/job-output');

module.exports = async function() {
    const logger = new JobLogger('update-crafts');
    try {
        logger.log('Loading json files...');
        const [items, json, en, areas, processedItems] = await Promise.all([
            tarkovData.items(),
            tarkovData.crafts(),
            tarkovData.locale('en'),
            jobOutput('update-hideout', './dumps/hideout_data.json', logger),
            jobOutput('update-item-cache', './dumps/item_data.json', logger),
        ]);
        const crafts = {
            updated: new Date(),
            data: [],
        };
        const stations = {};
        const inactiveStations = {};
        logger.log('Processing crafts...');
        for (const id in json) {
            const craft = json[id];
            const station = areas.find(area => area.areaType === craft.areaType);
            if (!station) {
                if (!inactiveStations[en[`hideout_area_${craft.areaType}_name`]]) {
                    inactiveStations[en[`hideout_area_${craft.areaType}_name`]] = 0;
                }
                inactiveStations[en[`hideout_area_${craft.areaType}_name`]]++;
                continue;
            }
            if (!processedItems[craft.endProduct]) {
                logger.warn(`${id}: No end product item with id ${craft.endProduct} found in processed items`);
                continue;
            }
            if (!stations[station.locale.en.name]) {
                stations[station.locale.en.name] = 0;
            }
            const craftData = {
                id: id,
                requiredItems: [],
                rewardItems: [{
                    name: processedItems[craft.endProduct].locale.en.name,
                    item: craft.endProduct,
                    count: craft.count,
                    attributes: []
                }],
                station: station.id,
                station_id: station.id,
                sourceName: station.locale.en.name,
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
                    if (!items[req.templateId]) {
                        logger.warn(`${id}: No requirement resource with id ${req.templateId} found in items.json`);
                        continue;
                    }
                    if (!processedItems[req.templateId]) {
                        logger.warn(`${id}: No requirement resource with id ${req.templateId} found in processed items`);
                        continue;
                    }
                    craftData.requiredItems.push({
                        name: processedItems[req.templateId].locale.en.name,
                        item: req.templateId,
                        count: req.resource / items[req.templateId]._props.Resource,
                        attributes: []
                    });
                } else if (req.type === 'Item') {
                    if (!processedItems[req.templateId]) {
                        logger.warn(`${id}: No requirement resource with id ${req.templateId} found in processed items`);
                        continue;
                    }
                    const reqData = {
                        name: processedItems[req.templateId].locale.en.name,
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
                    if (!processedItems[req.templateId]) {
                        logger.warn(`${id}: No requirement resource with id ${req.templateId} found in processed items`);
                        continue;
                    }
                    const reqData = {
                        name: processedItems[req.templateId].locale.en.name,
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
            craftData.source = `${station.locale.en.name} level ${craftData.level}`;
            crafts.data.push(craftData);
            stations[station.locale.en.name]++;
        }
        for (const stationName in stations) {
            logger.log(`✔️ ${stationName}: ${stations[stationName]}`);
        }
        for (const stationName in inactiveStations) {
            logger.log(`❌ ${stationName}: ${inactiveStations[stationName]}`);
        }
        logger.log(`Processed ${crafts.data.length} active crafts`);

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