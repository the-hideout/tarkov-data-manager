import remoteData from '../modules/remote-data.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import DataJob from '../modules/data-job.mjs';

const skipCrafts = [
    '66140c4a9688754de10dac07', // from event quest Take Two 660427dd7eb22f375205b656
    '660c2dbaa2a92e70cc074863', // from event quest Decryption Hurdles - Part 3 6604233fe73f456f6a07466b
    '6617cdb6b24b0ea24505f618', // from event quest Radio Club 6605a079ab236c96120c92c1
    '661e6c26750e453380391f55', // from event quest Getting to the Core 66042b8bab236c96120c929f
    '670932d7b564327a0e023fcb', // event flash drive craft
    '67092bbfc45f0546bf097a7e', // from event quest Radical Treatment
    '67093210d514d26f8408612b', // from event quest Clear Conscience
    '6745925da9c9adf0450d5bca', // from event quest That's a Great Plan, Walter
    '67449c79268737ef6908d636', // from event quest That's a Great Plan, Walter
];

class UpdateCraftsJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-crafts'});
        this.kvName = 'craft_data';
    }

    run = async () => {
        this.logger.log('Loading json files...');
        const [items, processedItems, en, presets] = await Promise.all([
            tarkovData.items(),
            remoteData.get(),
            tarkovData.locale('en'),
            this.jobOutput('update-presets'),
        ]);
        for (const gameMode of this.gameModes) {
            const areas = await this.jobOutput('update-hideout', {gameMode: gameMode.name});
            const tasks = await this.jobOutput('update-quests', {gameMode: gameMode.name});
            const json = await tarkovData.crafts({gameMode: gameMode.name}).then(recipes => {
                if (recipes.recipes) {
                    return recipes.recipes.reduce((crafts, craft) => {
                        crafts[craft._id] = craft;
                        return crafts;
                    }, {});
                }
                return recipes;
            });
            this.kvData[gameMode.name] = {
                Craft: [],
            };
            const stations = {};
            const inactiveStations = {};
            this.logger.log(`Processing ${gameMode.name} crafts...`);
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
                let endProduct = processedItems.get(craft.endProduct);
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
                if (endProduct.types.includes('gun')) {
                    const preset = Object.values(presets).find(p => p.baseId === endProduct.id && p.default);
                    if (preset) {
                        endProduct = processedItems.get(preset.id);
                    }
                }
                if (craft.locked && !craft.requirements.some(req => req.type === 'QuestComplete')) {
                    //this.logger.warn(`${id}: Craft for ${endProduct.name} is locked`);
                    continue;
                }
                if (skipCrafts.includes(id)) {
                    //this.logger.warn(`${id}: Craft for ${endProduct.name} is skipped`);
                    continue;
                }
                if (!stations[en[station.name]]) {
                    stations[en[station.name]] = 0;
                }
                const craftData = {
                    id: id,
                    requiredItems: [],
                    requiredQuestItems: [],
                    rewardItems: [{
                        name: endProduct.name,
                        item: endProduct.id,
                        count: craft.count,
                        attributes: []
                    }],
                    station: station.id,
                    station_id: station.id,
                    sourceName: en[station.name],
                    duration: craft.productionTime,
                    requirements: [],
                    gameEditions: [],
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
                        const rewardMatchesCraft = (craftUnlocks) => {
                            if (!craftUnlocks) {
                                return false;
                            }
                            for (const unlock of craftUnlocks) {
                                if (!unlock.items.some(i => i.id === endProduct.id)) {
                                    continue;
                                }
                                if (unlock.station_id !== craftData.station_id) {
                                    continue;
                                }
                                return true;
                            }
                            return false;
                        };
                        const task = tasks.find(q => rewardMatchesCraft(q.finishRewards.craftUnlock) || rewardMatchesCraft(q.startRewards.craftUnlock));
                        if (!task) {
                            this.logger.warn(`${id}: Unknown quest unlock for ${endProduct.name} ${endProduct.id}`);
                            continue;
                        }
                        craftData.requirements.push({
                            type: 'questCompleted',
                            value: task.tarkovDataId,
                            stringValue: task.id,
                        });
                        craftData.taskUnlock = task.id;
                    } else if (req.type === 'GameVersion') {
                        craftData.gameEditions = req.gameVersions;
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
                craftData.source = `${en[station.name]} level ${craftData.level}`;
                this.kvData[gameMode.name].Craft.push(craftData);
                stations[en[station.name]]++;
            }
            for (const stationName in stations) {
                this.logger.log(`✔️ ${stationName}: ${stations[stationName]}`);
            }
            for (const stationName in inactiveStations) {
                this.logger.log(`❌ ${stationName}: ${inactiveStations[stationName]}`);
            }
            this.logger.log(`Processed ${this.kvData[gameMode.name].Craft.length} active ${gameMode.name} crafts`);
            if (this.kvData[gameMode.name].Craft.length === 0) {
                this.addJobSummary(`${gameMode.name}`, 'Found No Crafts');
            }
    
            let kvName = this.kvName;
            if (gameMode.name !== 'regular') {
                kvName += `_${gameMode.name}`;
            }
            await this.cloudflarePut(this.kvData[gameMode.name], kvName);
        }
        return this.kvData;
    }
}

export default UpdateCraftsJob;
