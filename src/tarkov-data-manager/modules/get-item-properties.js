const tarkovChanges = require('../modules/tarkov-changes');

let locales = false;
let globals = false;

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

const setAll = async (loc = false, glob = false) => {
    return Promise.all([setLocales(loc), setGlobals(glob)]);
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
            recoil: item._props.ammoRec,
            initialSpeed: item._props.InitialSpeed,
            heavyBleedModifier: item._props.HeavyBleedingDelta,
            lightBleedModifier: item._props.LightBleedingDelta,
        };
    } else if (item._parent === '5448e54d4bdc2dcc718b4568' || item._parent === '5448e5284bdc2dcb718b4567') {
        // armor vests and tactical rigs
        if (!locales) return Promise.reject(new Error('Must call setItemPropertiesLocales before getItemProperties'));
        properties = {};
        if (item._parent === '5448e54d4bdc2dcc718b4568') {
            properties.propertiesType = 'ItemPropertiesArmor';
        } else if (item._parent === '5448e5284bdc2dcb718b4567') {
            properties.propertiesType = 'ItemPropertiesChestRig';
            properties.capacity = 0;
            properties.pouches = item._props.Grids.map(grid => {
                properties.capacity += (grid._props.cellsH * grid._props.cellsV);
                return {
                    width: grid._props.cellsH,
                    height: grid._props.cellsV
                };
            });
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
    } else if (item._parent === '5448e8d64bdc2dce718b4568' || item._parent === '5448e8d04bdc2ddf718b4569') {
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
    } else if (item._parent === '5a341c4086f77401f2541505' || item._parent === '57bef4c42459772e8d35a53b') {
        // headwear and ArmoredEquipment
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
            if (item._parent === '5a341c4086f77401f2541505') {
                properties.propertiesType = 'ItemPropertiesHelmet';
                properties.deafening = item._props.DeafStrength;
            } else if (item._parent === '57bef4c42459772e8d35a53b') {
                properties.propertiesType = 'ItemPropertiesArmorAttachment';
            }
        }
    } else if (parent && parent._parent === '5422acb9af1c889c16000029') {
        // weapons
        properties = {
            propertiesType: 'ItemPropertiesWeapon',
            caliber: item._props.ammoCaliber,
            ergonomics: item._props.Ergonomics,
            recoilVertical: item._props.RecoilForceUp,
            recoilHorizontal: item._props.RecoilForceBack,
            repairCost: item._props.RepairCost,
            default_ammo_id: item._props.defAmmo
        };
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
            recoil: item._props.Recoil
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
                    if (!effect.locale[code].type) return Promise.reject(new Error(`No ${code} translation found for stim buff type ${buff.BuffType}`));
                }
                properties.stimEffects.push(effect);
            }
        }
    }
    return properties;
};

module.exports = {
    setItemPropertiesLocales: setLocales,
    setItemPropertiesGlobals: setGlobals,
    setItemPropertiesLocalesGlobals: setAll,
    getSpecialItemProperties: getItemProperties
};