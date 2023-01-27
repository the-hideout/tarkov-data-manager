const remoteData = require('../modules/remote-data');
const tarkovData = require('../modules/tarkov-data');
const DataJob = require('../modules/data-job');

class UpdateCraftsJob extends DataJob {
    constructor(jobManager) {
        super({name: 'update-crafts', jobManager});
        this.kvName = 'craft_data';
    }

    run = async () => {
        this.logger.log('Loading json files...');
        const [items, json, en, processedItems] = await Promise.all([
            tarkovData.items(),
            tarkovData.crafts(),
            tarkovData.locale('en'),
            remoteData.get(),
        ]);
        const areas = await this.jobManager.jobOutput('update-hideout', this);
        const tasks = await this.jobManager.jobOutput('update-quests', this);
        const crafts = {
            Craft: [],
        };
        const stations = {};
        const inactiveStations = {};
        this.logger.log('Processing crafts...');
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
            const endProduct = processedItems.get(craft.endProduct);
            if (!endProduct) {
                this.logger.warn(`${id}: No end product item with id ${craft.endProduct} found in items`);
                continue;
            }
            if (endProduct.types.includes('disabled')) {
                this.logger.warn(`${id}: End product ${endProduct.name} ${craft.endProduct} is disabled`);
                continue;
            }
            if (endProduct.types.includes('quest')) {
                this.logger.warn(`${id}: End product ${endProduct.name} ${craft.endProduct} is a quest item`);
                continue;
            }
            if (!stations[station.locale.en.name]) {
                stations[station.locale.en.name] = 0;
            }
            const craftData = {
                id: id,
                requiredItems: [],
                requiredQuestItems: [],
                rewardItems: [{
                    name: endProduct.name,
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
            let skip = false;
            for (const index in craft.requirements) {
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
                        this.logger.warn(`${id}: Resource ${en[`${req.templateId} Name`]} ${req.templateId} not found in items.json`);
                        continue;
                    }
                    const resourceItem = processedItems.get(req.templateId);
                    if (!resourceItem) {
                        this.logger.warn(`${id}: Resource ${en[`${req.templateId} Name`]} ${req.templateId} not found in items`);
                        continue;
                    }
                    if (resourceItem.types.includes('disabled')) {
                        this.logger.warn(`${id}: Resource ${resourceItem.name} ${req.templateId} is disabled`);
                        continue;
                    }
                    if (resourceItem.types.includes('quest')) {
                        this.logger.warn(`${id}: Resource ${resourceItem.name} ${req.templateId} is a quest item`);
                        continue;
                    }
                    craftData.requiredItems.push({
                        name: processedItems.get(req.templateId).name,
                        item: req.templateId,
                        count: req.resource / items[req.templateId]._props.Resource,
                        attributes: []
                    });
                } else if (req.type === 'Item') {
                    const ingredient = processedItems.get(req.templateId);
                    if (!ingredient) {
                        this.logger.warn(`${id}: Ingredient item ${en[`${req.templateId} Name`]} ${req.templateId} found in items`);
                        continue;
                    }
                    if (ingredient.types.includes('disabled')) {
                        this.logger.warn(`${id}: Ingredient ${ingredient.name} ${ingredient.id} is disabled`);
                        continue;
                    }
                    if (ingredient.types.includes('quest')) {
                        this.logger.warn(`${id}: Ingredient ${ingredient.name} ${ingredient.id} is a quest item`);
                        continue;
                    }
                    const reqData = {
                        name: processedItems.get(req.templateId).name,
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
                    const toolItem = processedItems.get(req.templateId);
                    if (!toolItem) {
                        this.logger.warn(`${id}: Unknown tool ${en[`${req.templateId} Name`]} ${req.templateId}`);
                        if (items[req.templateId] && items[req.templateId]._props.QuestItem) {
                            skip = true;
                        }
                        continue;
                    }
                    if (toolItem.types.includes('quest')) {
                        craftData.requiredQuestItems.push({
                            name: toolItem.name,
                            item: req.templateId,
                        });
                        continue;
                    }
                    craftData.requiredItems.push({
                        name: toolItem.name,
                        item: req.templateId,
                        count: 1,
                        attributes: [{
                            type: 'tool',
                            value: String(true)
                        }]
                    });
                } else if (req.type === 'QuestComplete') {
                    const task = tasks.find(q => q.id === req.questId);
                    if (!task) {
                        this.logger.warn(`${id}: Unknown quest unlock ${en[`${req.questId} name`]} ${req.questId}`);
                        continue;
                    }
                    craftData.requirements.push({
                        type: 'questCompleted',
                        value: task.tarkovDataId,
                        stringValue: task.id,
                    });
                    craftData.taskUnlock = task.id;
                } else {
                    this.logger.warn(`${id}: Unknown craft requirement type ${req.type}`);
                }
            }
            if (skip) {
                continue;
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
            crafts.Craft.push(craftData);
            stations[station.locale.en.name]++;
        }
        for (const stationName in stations) {
            this.logger.log(`✔️ ${stationName}: ${stations[stationName]}`);
        }
        for (const stationName in inactiveStations) {
            this.logger.log(`❌ ${stationName}: ${inactiveStations[stationName]}`);
        }
        this.logger.log(`Processed ${crafts.Craft.length} active crafts`);

        await this.cloudflarePut(crafts);
        return crafts;
    }
}

module.exports = UpdateCraftsJob;
