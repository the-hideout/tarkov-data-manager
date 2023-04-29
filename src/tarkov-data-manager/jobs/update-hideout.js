const got = require('got');

const tarkovData = require('../modules/tarkov-data');
const normalizeName = require('../modules/normalize-name');
const { setLocales, getTranslations, addTranslations } = require('../modules/get-translation');
const DataJob = require('../modules/data-job');

const skipChristmasTree = true;

class UpdateHideoutJob extends DataJob {
    constructor() {
        super('update-hideout');
        this.kvName = 'hideout_data';
    }

    async run() {
        [this.data, this.locales, this.items, this.tdHideout] = await Promise.all([
            tarkovData.areas(),
            tarkovData.locales(),
            tarkovData.items(),
            got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/hideout.json', {
                responseType: 'json',
                resolveBodyOnly: true,
            })
        ]);
        const en = this.locales.en;
        setLocales(this.locales);
        const hideoutData = {
            HideoutStation: [],
        };
        const areasByType = {};
        for (const stationId in this.data) {
            areasByType[this.data[stationId].type] = stationId;
        }
        for (const stationId in this.data) {
            const station = this.data[stationId];
            if (!en[`hideout_area_${station.type}_name`]) {
                this.logger.warn(`❌ ${station.type} not found in locale_en.json`);
                continue;
            }
            const stationData = {
                id: station._id,
                name: en[`hideout_area_${station.type}_name`],
                normalizedName: normalizeName(en[`hideout_area_${station.type}_name`]),
                areaType: station.type,
                levels: [],
                locale: getTranslations({name: `hideout_area_${station.type}_name`}, this.logger),
            };
            if (!station.enabled || (skipChristmasTree && stationId === '5df8a81f8f77747fcf5f5702')) {
                this.logger.log(`❌ ${stationData.name}`);
                continue;
            }
            this.logger.log(`✔️ ${stationData.name}`);
            for (const tdStation of this.tdHideout.stations) {
                if (tdStation.locales.en.toLowerCase() === stationData.name.toLowerCase()) {
                    stationData.tarkovDataId = tdStation.id;
                    break;
                }
            }
            if (typeof stationData.tarkovDataId === 'undefined') {
                this.logger.warn(`Could not find TarkovData id for ${stationData.name}`);
            }
            for (let i = 1; i < Object.keys(station.stages).length; i++) {
                if (!station.stages[String(i)]) {
                    this.logger.warn(`No stage found for ${stationData.name} level ${i}`);
                    continue;
                }
                if (!en[`hideout_area_${station.type}_stage_${i}_description`]) {
                    this.logger.warn(`No stage ${i} description found for ${stationData.name}`);
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
                    bonuses: this.getBonuses(stage.bonuses),
                    locale: getTranslations({description: `hideout_area_${station.type}_stage_${i}_description`}),
                };
                for (const tdModule of this.tdHideout.modules) {
                    if (tdModule.stationId === stationData.tarkovDataId && tdModule.level === stageData.level) {
                        stageData.tarkovDataId = tdModule.id;
                        break;
                    }
                }
                if (typeof stageData.tarkovDataId === 'undefined') {
                    this.logger.warn(`Could not find tarkovData id for ${stationData.name} level ${stageData.level}`);
                }
                if (i === 1 && station.requirements.length > 0) {
                    stage.requirements = [
                        ...station.requirements,
                        ...stage.requirements,
                    ];
                }
                for (let r = 0; r < stage.requirements.length; r++) {
                    const req = stage.requirements[r];
                    if (req.type === 'Item') {
                        stageData.itemRequirements.push({
                            id: `${stationData.id}-${i}-${r}`,
                            item: req.templateId,
                            name: en[`${req.templateId} Name`],
                            count: req.count || 1,
                            //functional: req.isFunctional
                        });
                    } else if (req.type === 'Skill') {
                        const skillReq = {
                            id: `${stationData.id}-${i}-${r}`,
                            name: en[req.skillName] || req.skillName,
                            level: req.skillLevel,
                            locale: getTranslations({name: req.skillName}),
                        };
                        stageData.skillRequirements.push(skillReq);
                    } else if (req.type === 'Area') {
                        if (req.requiredLevel < 1) {
                            this.logger.warn(`Skipping ${en[`hideout_area_${req.areaType}_name`]} level ${req.requiredLevel} requirement for ${en[`hideout_area_${station.type}_name`]} level ${i}`);
                            continue;
                        }
                        stageData.stationLevelRequirements.push({
                            id: `${stationData.id}-${i}-${r}`,
                            station: areasByType[req.areaType],
                            name: en[`hideout_area_${req.areaType}_name`],
                            level: req.requiredLevel
                        });
                    } else if (req.type === 'TraderLoyalty') {
                        stageData.traderRequirements.push({
                            id: `${stationData.id}-${i}-${r}`,
                            trader_id: req.traderId,
                            name: en[`${req.traderId} Nickname`],
                            level: req.loyaltyLevel
                        });
                    } else {
                        this.logger.warn(`Unrecognized requirement type ${req.type} for ${stationData.name} ${i}`);
                        continue;
                    }
                }
                //ensure all modules require the previous module
                if (stageData.level > 1) {
                    const prevReq = stageData.stationLevelRequirements.find(req => req.station === stationData.id);
                    if (!prevReq) {
                        this.logger.warn(`Added level ${stageData.level-1} as requirement for level ${stageData.level}`);
                        stageData.stationLevelRequirements.push({
                            id: `${stationData.id}-${i}-${stage.requirements.length}`,
                            station: stationData.id,
                            name: stationData.name,
                            level: stageData.level - 1,
                        });
                    } else if (prevReq.level !== i -1) {
                        this.logger.warn(`Changed level ${prevReq.level} to ${i - 1} as requirement for level ${stageData.level}`);
                        prevReq.level = i - 1;
                    }
                }
                stationData.levels.push(stageData);
            }
            hideoutData.HideoutStation.push(stationData);
        }
        this.logger.success(`Processed ${hideoutData.HideoutStation.length} hideout stations`);

        hideoutData.HideoutModule = await this.jobManager.runJob('update-hideout-legacy', {data: this.tdHideout, parent: this});

        await this.cloudflarePut(hideoutData);
        return hideoutData;
    }

    getBonuses(bonuses) {
        const bonusesData = [];
        for (const bonus of bonuses) {
            if (bonus.type === 'TextBonus') {
                continue;
            }
            const bonusData = {
                type: bonus.type,
                value: this.bonusValueFilter(bonus),
                passive: bonus.passive,
                production: bonus.production,
                locale: getTranslations({name: `hideout_${bonus.id || bonus.type}`}),
            };
            if (bonus.filter) {
                bonusData.slotItems = bonus.filter;
            }
            if (bonus.skillType) {
                addTranslations(bonusData.locale, {skillName: bonus.skillType}, this.logger);
            }
            bonusesData.push(bonusData);
        }
        return bonusesData;
    }

    bonusValueFilter(bonus) {
        if (bonus.type === 'StashSize') {
            const stashGridProps = this.items[bonus.templateId]._props.Grids[0]._props;
            return stashGridProps.cellsH * stashGridProps.cellsV;
        }
        const absoluteTypes = [
            'AdditionalSlots',
            'MaximumEnergyReserve',
            'UnlockArmorRepair',
            'UnlockWeaponModification',
            'UnlockWeaponRepair',
        ];
        if (absoluteTypes.includes(bonus.type)) {
            return bonus.value;
        }
        return bonus.value / 100;
    }
}

module.exports = UpdateHideoutJob;
