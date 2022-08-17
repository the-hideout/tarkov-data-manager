const tarkovChanges = require('../modules/tarkov-changes');
const JobLogger = require('../modules/job-logger');

let locales = false;
let globals = false;
let items = false;
let logger = false;
let itemIds = false;
let disabledItemIds = false;

const topCategories = [
    '54009119af1c881c07000029', // Item
    '566162e44bdc2d3f298b4573', // Compound item
    '5661632d4bdc2d903d8b456b', // Stackable item
    '566168634bdc2d144c8b456c', // Searchable item
];

const setLocales = async (loc = false) => {
    if (loc) {
        locales = loc;
    } else {
        locales = await tarkovChanges.locales();
    }
};

const setGlobals = async (glob = false) => {
    if (glob) {
        globals = glob;
    } else {
        globals = await tarkovChanges.globals();
    }
};

const setItems = async (it = false) => {
    if (it) {
        items = it;
    } else {
        items = await tarkovChanges.items();
    }
}

const setAll = async (options) => {
    const optionMap = {
        items: setItems,
        locales: setLocales,
        globals: setGlobals,
        logger: lgr => {
            logger = lgr;
        },
        itemIds: ids => {
            itemIds = ids;
        },
        disabledItemIds: ids => {
            disabledItemIds = ids;
        }
    };
    for (const key in options) {
        if (optionMap[key]) {
            await optionMap[key](options[key]);
        } 
    }
    if (!logger) logger = new JobLogger('get-item-properties', false);
};

const hasCategory = (item, catId) => {
    if (item._id === catId) return true;
    const parent = items[item._parent];
    if (parent) return hasCategory(parent, catId);
    return false;
};

const getFilterConstraints = (item, grid) => {
    const constraints = {
        allowedCategories: [],
        allowedItems: [],
        excludedCategories: [],
        excludedItems: []
    };
    //if (grid._props.filters.length !== 1) logger.warn(`${item._props.Name} (${item._id}) contains ${grid._props.filters.length} filter sets`)
    for (const filterSet of grid._props.filters) {
        for (const allowed of filterSet.Filter) {
            if (itemIds.includes(allowed)) {
                if (!disabledItemIds.includes(allowed)) constraints.allowedItems.push(allowed);
                continue;
            }
            if (items[allowed]._type === 'Item') continue;
            constraints.allowedCategories.push(allowed);
        }
        if (!filterSet.ExcludedFilter) continue;
        for (const excluded of filterSet.ExcludedFilter) {
            if (itemIds.includes(excluded)) {
                if (!disabledItemIds.includes(excluded)) constraints.excludedItems.push(excluded);
                continue;
            }
            if (items[excluded]._type === 'Item') continue;
            constraints.excludedCategories.push(excluded);
        }
    }
    return constraints;
};

const getGrids = (item) => {
    let capacity = 0;
    let grids = item._props.Grids.map(grid => {
        capacity += (grid._props.cellsH * grid._props.cellsV);
        return {
            width: grid._props.cellsH,
            height: grid._props.cellsV,
            filters: getFilterConstraints(item, grid)
        };
    });
    return {capacity, grids};
};

const getSlots = (item) => {
    return item._props.Slots.map(slot => {
        return {
            name: slot._name,
            filters: getFilterConstraints(item, slot)
        };
    });
};

const grenadeMap = {
    'Grenade_new': 'Grenade',
    'Grenade_new2': 'Impact Grenade',
    'Flashbang': 'Flashbang',
    '': 'Smoke',
    'grenade_smoke_m18_green': 'Smoke',
};

const weaponMods = [
    '55802f3e4bdc2de7118b4584', // gear mod
    '5448fe394bdc2d0d028b456c', // muzzle device
    '5448fe7a4bdc2d6f028b456b', // sights
    '55802f4a4bdc2ddb688b4569', // essential mod
    '550aa4154bdc2dd8348b456b', // functional mod
    '55818aeb4bdc2ddc698b456a', // special scope
    '5448bc234bdc2d3c308b4569', // magazine, which CylinderMagazine is a child of
];

const getItemProperties = async (item, parent = false) => {
    let properties = null;
    if (item._parent === '5485a8684bdc2da71d8b4567') {
        // ammo
        properties = {
            propertiesType: 'ItemPropertiesAmmo',
            caliber: item._props.Caliber,
            stackMaxSize: item._props.StackMaxSize,
            tracer: item._props.Tracer,
            tracerColor: item._props.TracerColor,
            ammoType: item._props.ammoType,
            projectileCount: item._props.ProjectileCount,
            damage: item._props.Damage,
            armorDamage: item._props.ArmorDamage,
            fragmentationChance: item._props.FragmentationChance,
            ricochetChance: item._props.RicochetChance,
            penetrationChance: item._props.PenetrationChance,
            penetrationPower: item._props.PenetrationPower,
            accuracy: item._props.ammoAccr,
            accuracyModifier: item._props.ammoAccr / 100,
            recoil: item._props.ammoRec,
            recoilModifier: item._props.ammoRec / 100,
            initialSpeed: item._props.InitialSpeed,
            heavyBleedModifier: item._props.HeavyBleedingDelta,
            lightBleedModifier: item._props.LightBleedingDelta,
            durabilityBurnFactor: item._props.DurabilityBurnModificator,
            heatFactor: item._props.HeatFactor
        };
        if (item._props.IsLightAndSoundShot) {
            properties.ammoType = 'flashbang';
        }
    } else if (item._parent === '5448e54d4bdc2dcc718b4568' || item._parent === '5448e5284bdc2dcb718b4567') {
        // armor vests and tactical rigs
        if (!locales) return Promise.reject(new Error('Must call setItemPropertiesLocales before getItemProperties'));
        properties = {};
        if (item._parent === '5448e54d4bdc2dcc718b4568') {
            properties.propertiesType = 'ItemPropertiesArmor';
        } else if (item._parent === '5448e5284bdc2dcb718b4567') {
            properties.propertiesType = 'ItemPropertiesChestRig';
            properties = {
                ...properties,
                ...getGrids(item)
            };
        }
        if (item._props.armorClass) {
            properties = {
                ...properties,
                class: parseInt(item._props.armorClass),
                durability: parseInt(item._props.Durability),
                repairCost: parseInt(item._props.RepairCost),
                speedPenalty: parseInt(item._props.speedPenaltyPercent) / 100,
                turnPenalty: parseInt(item._props.mousePenalty) / 100,
                ergoPenalty: parseInt(item._props.weaponErgonomicPenalty),
                zones: item._props.armorZone.map(key => {
                    return locales.en.interface[key];
                }),
                armor_material_id: item._props.ArmorMaterial,
                locale: {}
            };
            for (const code in locales) {
                properties.locale[code] = {
                    zones: item._props.armorZone.map(key => {
                        return locales[code].interface[key];
                    })
                };
            }
        }
    } else if (item._parent === '5448e53e4bdc2d60728b4567') {
        properties = {
            propertiesType: 'ItemPropertiesBackpack',
            ...getGrids(item)
        };
    } else if (item._parent === '543be6564bdc2df4348b4568') {
        // grenades
        properties = {
            propertiesType: 'ItemPropertiesGrenade',
            fuse: item._props.explDelay,
            minExplosionDistance: item._props.MinExplosionDistance,
            maxExplosionDistance: item._props.MaxExplosionDistance,
            fragments: item._props.FragmentsCount,
            contusionRadius: item._props.ContusionDistance
        };
        properties.type = grenadeMap[item._props.ExplosionEffectType] ? grenadeMap[item._props.ExplosionEffectType] : item._props.ExplosionEffectType;
    } else if (hasCategory(item, '543be6674bdc2df1348b4569')) {
        // food and drink
        properties = {
            propertiesType: 'ItemPropertiesFoodDrink',
            energy: 0,
            hydration: 0,
            units: item._props.MaxResource
        };
        if (item._props.effects_health.Energy) {
            properties.energy = item._props.effects_health.Energy.value;
        }
        if (item._props.effects_health.Hydration) {
            properties.hydration = item._props.effects_health.Hydration.value;
        }
    } else if (item._parent === '5a341c4086f77401f2541505' || item._parent === '57bef4c42459772e8d35a53b' || item._parent === '5a341c4686f77469e155819e') {
        // headwear and ArmoredEquipment and FaceCover
        if (item._props.armorClass && parseInt(item._props.armorClass) > 0) {
            // armored stuff only only
            properties = {
                class: parseInt(item._props.armorClass),
                durability: parseInt(item._props.Durability),
                repairCost: parseInt(item._props.RepairCost),
                speedPenalty: parseInt(item._props.speedPenaltyPercent) / 100,
                turnPenalty: parseInt(item._props.mousePenalty) / 100,
                ergoPenalty: parseInt(item._props.weaponErgonomicPenalty),
                headZones: item._props.headSegments.map(key => {
                    return locales.en.interface[key];
                }),
                blindnessProtection: item._props.BlindnessProtection,
                armor_material_id: item._props.ArmorMaterial,
                locale: {}
            };
            for (const code in locales) {
                properties.locale[code] = {
                    headZones: item._props.headSegments.map(key => {
                        return locales[code].interface[key];
                    })
                };
            }
            if (item._parent === '5a341c4086f77401f2541505' || item._parent === '5a341c4686f77469e155819e') {
                properties.propertiesType = 'ItemPropertiesHelmet';
                properties.deafening = item._props.DeafStrength;
                properties.slots = getSlots(item);
            } else if (item._parent === '57bef4c42459772e8d35a53b') {
                properties.propertiesType = 'ItemPropertiesArmorAttachment';
            } 
        }
    } else if (item._parent === '5448e5724bdc2ddf718b4568') {
        properties = {
            propertiesType: 'ItemPropertiesGlasses',
            class: parseInt(item._props.armorClass),
            durability: parseInt(item._props.Durability),
            repairCost: parseInt(item._props.RepairCost),
            blindnessProtection: item._props.BlindnessProtection,
            speedPenalty: parseInt(item._props.speedPenaltyPercent) / 100,
            turnPenalty: parseInt(item._props.mousePenalty) / 100,
            ergoPenalty: parseInt(item._props.weaponErgonomicPenalty),
            armor_material_id: item._props.ArmorMaterial,
        };
    } else if (item._parent === '5795f317245977243854e041' || item._parent === '5671435f4bdc2d96058b4569' || item._parent === '5448bf274bdc2dfc2f8b456a') {
        properties = {
            propertiesType: 'ItemPropertiesContainer',
            ...getGrids(item)
        };
    } else if (parent && parent._parent === '5422acb9af1c889c16000029') {
        // weapons
        properties = {
            propertiesType: 'ItemPropertiesWeapon',
            caliber: item._props.ammoCaliber,
            ergonomics: item._props.Ergonomics,
            recoilVertical: item._props.RecoilForceUp,
            recoilHorizontal: item._props.RecoilForceBack,
            repairCost: item._props.RepairCost,
            default_ammo_id: item._props.defAmmo,
            fireRate: item._props.bFirerate,
            effectiveDistance: item._props.bEffDist,
            sightingRange: item._props.SightingRange,
            maxDurability: item._props.MaxDurability,
            fireModes: item._props.weapFireType.map(mode => {
                return locales.en.interface[mode];
            }),
            allowedAmmo: item._props.Chambers[0]?._props.filters[0].Filter.filter(id => {
                return itemIds.includes(id) && !disabledItemIds.includes(id);
            }) || [],
            slots: getSlots(item),
            locale: {}
        };
        for (const code in locales) {
            properties.locale[code] = {
                fireModes: item._props.weapFireType.map(mode => {
                    return locales[code].interface[mode];
                }),
            };
        }
    } else if (item._parent === '5a2c3a9486f774688b05e574') {
        // night vision
        properties = {
            propertiesType: 'ItemPropertiesNightVision',
            intensity: item._props.Intensity,
            noiseIntensity: item._props.NoiseIntensity,
            noiseScale: item._props.NoiseScale,
            diffuseIntensity: item._props.DiffuseIntensity,
        };
    } else if (item._parent === '5d21f59b6dbe99052b54ef83') {
        // thermal vision
        // capture here otherwise it will be counted as a weapon mod
    } else if (parent && weaponMods.includes(parent._parent)) {
        properties = {
            propertiesType: 'ItemPropertiesWeaponMod',
            ergonomics: item._props.Ergonomics,
            recoil: item._props.Recoil,
            recoilModifier: item._props.Recoil / 100,
            accuracyModifier: item._props.Accuracy / 100,
            slots: getSlots(item)
        };
        if (item._parent === '55818add4bdc2d5b648b456f' || item._parent === '55818ae44bdc2dde698b456c') {
            properties.propertiesType = 'ItemPropertiesScope';
            properties.zoomLevels = item._props.Zooms;
        } else if (item._parent == '5448bc234bdc2d3c308b4569' || item._parent === '610720f290b75a49ff2e5e25') {
            properties.propertiesType = 'ItemPropertiesMagazine';
            properties.capacity = item._props.Cartridges[0]._max_count;
            properties.loadModifier = item._props.LoadUnloadModifier / 100;
            properties.ammoCheckModifier = item._props.CheckTimeModifier / 100;
            properties.malfunctionChance = item._props.MalfunctionChance;
            properties.allowedAmmo = item._props.Cartridges[0]._props.filters[0].Filter.filter(id => {
                return itemIds.includes(id) && !disabledItemIds.includes(id);
            });
        }
    } else if (item._parent === '5448f3ac4bdc2dce718b4569') {
        properties = {
            propertiesType: 'ItemPropertiesMedicalItem',
            uses: item._props.MaxHpResource || 1,
            useTime: item._props.medUseTime,
            cures: Object.keys(item._props.effects_damage).map(status => {
                if (status === 'DestroyedPart') return 'LostLimb';
                return status;
            }),
            locale: {},
        };
        if (item._props.effects_damage.DestroyedPart) {
            properties.propertiesType = 'ItemPropertiesSurgicalKit';
            properties.minLimbHealth = item._props.effects_damage.DestroyedPart.healthPenaltyMin / 100;
            properties.maxLimbHealth = item._props.effects_damage.DestroyedPart.healthPenaltyMax / 100;
        }
    } else if (item._parent === '5448f39d4bdc2d0a728b4568') {
        properties = {
            propertiesType: 'ItemPropertiesMedKit',
            hitpoints: item._props.MaxHpResource,
            useTime: item._props.medUseTime,
            maxHealPerUse: item._props.hpResourceRate,
            cures: Object.keys(item._props.effects_damage).filter(status => {
                return status !== 'RadExposure';
            }),
        };
        const hpCosts = ['LightBleeding', 'HeavyBleeding'];
        for (const status of hpCosts) {
            properties[`hpCost${status}`] = null;
            if (properties.cures.includes(status)) {
                properties[`hpCost${status}`] = item._props.effects_damage[status].cost;
            }
        }
    } else if (item._parent === '5448f3a14bdc2d27728b4569') {
        properties = {
            propertiesType: 'ItemPropertiesPainkiller',
            uses: item._props.MaxHpResource | 1,
            useTime: item._props.medUseTime,
            cures: Object.keys(item._props.effects_damage).filter(status => {
                return status !== 'RadExposure';
            }),
            painkillerDuration: item._props.effects_damage.Pain.duration,
            energyImpact: 0,
            hydrationImpact: 0
        };
        if (item._props.effects_health.Energy) {
            properties.energyImpact = item._props.effects_health.Energy.value;
        }
        if (item._props.effects_health.Hydration) {
            properties.hydrationImpact = item._props.effects_health.Hydration.value;
        }
    } else if (item._parent === '5448f3a64bdc2d60728b456a') {
        const effectMap = {
            RemoveAllBloodLosses: 'Removeallbloodlosses'
        };
        properties = {
            propertiesType: 'ItemPropertiesStim',
            useTime: item._props.medUseTime,
            cures: Object.keys(item._props.effects_damage).filter(status => {
                return status !== 'RadExposure';
            }),
            stimEffects: [],
        };
        if (item._props.StimulatorBuffs && globals.config.Health.Effects.Stimulator.Buffs[item._props.StimulatorBuffs]) {
            const buffs = globals.config.Health.Effects.Stimulator.Buffs[item._props.StimulatorBuffs];
            for (const buff of buffs) {
                let effectKey = effectMap[buff.BuffType] || buff.BuffType;
                const effect = {
                    type: locales.en.interface[effectKey],
                    chance: buff.Chance,
                    delay: buff.Delay,
                    duration: buff.Duration,
                    value: buff.Value,
                    percent: !buff.AbsoluteValue,
                    locale: {}
                };
                if (buff.SkillName) {
                    effect.type = locales.en.interface.Skill;
                    effect.skillName = locales.en.interface[buff.SkillName];
                }
                for (const code in locales) {
                    effect.locale[code] = {
                        type: locales[code].interface[effectKey],
                    };
                    if (buff.SkillName) {
                        effect.locale[code].type = locales[code].interface.Skill;
                        effect.locale[code].skillName = locales[code].interface[buff.SkillName];
                    }
                    if (!effect.locale[code].type) effect.locale[code].type = locales.en.interface[effectKey];//return Promise.reject(new Error(`No ${code} translation found for stim buff type ${buff.BuffType}`));
                }
                properties.stimEffects.push(effect);
            }
        }
    } else if (hasCategory(item, '543be5e94bdc2df1348b4568')) {
        properties = {
            propertiesType: 'ItemPropertiesKey',
            uses: item._props.MaximumNumberOfUsage
        };
    } else if (item._parent === '5447e1d04bdc2dff2f8b4567') {
        properties = {
            propertiesType: 'ItemPropertiesMelee',
            slashDamage: item._props.knifeHitSlashDam,
            stabDamage: item._props.knifeHitStabDam,
            hitRadius: item._props.knifeHitRadius
        };
    }
    return properties;
};

module.exports = {
    setItemPropertiesOptions: setAll,
    getSpecialItemProperties: getItemProperties,
    topCategories: topCategories
};