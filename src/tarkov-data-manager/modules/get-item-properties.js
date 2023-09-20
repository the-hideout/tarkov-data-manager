let itemIds = false;
let disabledItemIds = false;
let job = false;

const topCategories = [
    '54009119af1c881c07000029', // Item
    '566162e44bdc2d3f298b4573', // Compound item
    '5661632d4bdc2d903d8b456b', // Stackable item
    '566168634bdc2d144c8b456c', // Searchable item
];

const setAll = async (options) => {
    const optionMap = {
        itemIds: ids => {
            itemIds = ids;
        },
        disabledItemIds: ids => {
            disabledItemIds = ids;
        },
        job: j => {
            job = j;
        },
    };
    for (const key in options) {
        if (optionMap[key]) {
            await optionMap[key](options[key]);
        } 
    }
};

const hasCategory = (item, catId) => {
    if (Array.isArray(catId)) {
        for (const id of catId) {
            if (hasCategory(item, id)) {
                return true;
            }
        }
        return false;
    }
    if (item._id === catId) return true;
    const parent = job.bsgItems[item._parent];
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
    //if (grid._props.filters.length !== 1) job.logger.warn(`${item._props.Name} (${item._id}) contains ${grid._props.filters.length} filter sets`)
    for (const filterSet of grid._props.filters) {
        for (const allowed of filterSet.Filter) {
            if (itemIds.includes(allowed)) {
                if (!disabledItemIds.includes(allowed)) constraints.allowedItems.push(allowed);
                continue;
            }
            if (job.bsgItems[allowed]._type === 'Item') continue;
            constraints.allowedCategories.push(allowed);
        }
        if (!filterSet.ExcludedFilter) continue;
        for (const excluded of filterSet.ExcludedFilter) {
            if (itemIds.includes(excluded)) {
                if (!disabledItemIds.includes(excluded)) constraints.excludedItems.push(excluded);
                continue;
            }
            if (job.bsgItems[excluded]._type === 'Item') continue;
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
    const slotReplacements = [
        {pattern: /_(\d+)$/, replacement: ''},
        {pattern:/_AKMS$/, replacement: ''}, 
        {pattern: /_AXIS$/, replacement: ''},
        {pattern: /^MOD_FLASHLIGHT$/, replacement: 'MOD_TACTICAL'},
        {pattern: /CAMORA/, replacement: 'PATRON_IN_WEAPON'},
    ];
    return item._props.Slots.map(slot => {
        let nameKey = slot._name.toUpperCase();
        for (const rep of slotReplacements) {
            nameKey = nameKey.replace(rep.pattern, rep.replacement);
        }
        const missingTranslations = [];
        const formattedSlot = {
            id: slot._id,
            nameId: slot._name,
            required: slot._required,
            filters: getFilterConstraints(item, slot),
            name: job.addTranslation(nameKey, (lang, code) => {
                if (lang[nameKey]) {
                    return lang[nameKey].replace(/(?<!^|\s)\p{Lu}/gu, substr => {
                        return substr.toLowerCase();
                    });
                } else {
                    missingTranslations.push(code);
                    return nameKey.replace('MOD_', '').replace('_', ' ').replace(/(?<!^|\s)\p{Lu}/gu, substr => {
                        return substr.toLowerCase();
                    });
                }
            }),
        };
        if (missingTranslations.length > 0) job.logger.warn(`Could not find ${missingTranslations.join(', ')} label for ${nameKey} slot of ${item._id}`);
        return formattedSlot;
    });
};

const effectMap = {
    RemoveAllBloodLosses: 'Removeallbloodlosses'
};

const getStimEffects = (item) => {
    const stimEffects = [];
    if (item._props.StimulatorBuffs && job.globals.config.Health.Effects.Stimulator.Buffs[item._props.StimulatorBuffs]) {
        const buffs = job.globals.config.Health.Effects.Stimulator.Buffs[item._props.StimulatorBuffs];
        for (const buff of buffs) {
            let effectKey = effectMap[buff.BuffType] || buff.BuffType;
            const effect = {
                chance: buff.Chance,
                delay: buff.Delay,
                duration: buff.Duration,
                value: buff.Value,
                percent: !buff.AbsoluteValue,
                type: buff.SkillName ? job.addTranslation('Skill') : job.addTranslation(effectKey),
                skillName: buff.SkillName ? job.addTranslation(buff.SkillName) : undefined
            };
            stimEffects.push(effect);
        }
    }
    return stimEffects;
};

const grenadeMap = {
    'Grenade_new': 'Grenade',
    'Grenade_new2': 'Impact Grenade',
    'Flashbang': 'Flashbang',
    '': 'Smoke',
    'grenade_smoke_m18_green': 'Smoke',
};

const getItemProperties = async (item) => {
    if (!job.presets) {
        return Promise.reject(new Error('Must set presets before calling getItemProperties'));
    }
    let properties = null;
    if (item._parent === '5485a8684bdc2da71d8b4567') {
        // ammo
        properties = {
            propertiesType: 'ItemPropertiesAmmo',
            ballisticCoeficient: item._props.BallisticCoeficient,
            bulletDiameterMilimeters: item._props.BulletDiameterMilimeters,
            bulletMassGrams: item._props.BulletMassGram,
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
            heatFactor: item._props.HeatFactor,
            staminaBurnPerDamage: item._props.StaminaBurnPerDamage,
        };
        if (item._props.IsLightAndSoundShot) {
            properties.ammoType = 'flashbang';
        }
    } else if (hasCategory(item, ['5448e54d4bdc2dcc718b4568', '5448e5284bdc2dcb718b4567'])) {
        // armor vests and tactical rigs
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
                bluntThroughput: item._props.BluntThroughput,
                class: parseInt(item._props.armorClass),
                durability: parseInt(item._props.Durability),
                repairCost: parseInt(item._props.RepairCost),
                speedPenalty: parseInt(item._props.speedPenaltyPercent) / 100,
                turnPenalty: parseInt(item._props.mousePenalty) / 100,
                ergoPenalty: parseInt(item._props.weaponErgonomicPenalty),
                armor_material_id: item._props.ArmorMaterial,
                zones: job.addTranslation(item._props.armorZone.map(zone => `QuestCondition/Elimination/Kill/BodyPart/${zone}`)),
                armorType: job.addTranslation(item._props.ArmorType, (lang) => {
                    if (item._props.ArmorType !== 'None') {
                        return lang[item._props.ArmorType];
                    }
                    return lang['NONE'].replace(/(?<!^|\s)\p{Lu}/gu, substr => {
                        return substr.toLowerCase();
                    });
                }),
            };
        }
    } else if (item._parent === '5448e53e4bdc2d60728b4567') {
        properties = {
            propertiesType: 'ItemPropertiesBackpack',
            speedPenalty: parseInt(item._props.speedPenaltyPercent) / 100,
            turnPenalty: parseInt(item._props.mousePenalty) / 100,
            ergoPenalty: parseInt(item._props.weaponErgonomicPenalty),
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
            units: item._props.MaxResource,
            stimEffects: getStimEffects(item),
        };
        if (item._props.effects_health.Energy) {
            properties.energy = item._props.effects_health.Energy.value;
        }
        if (item._props.effects_health.Hydration) {
            properties.hydration = item._props.effects_health.Hydration.value;
        }
    } else if (item._parent === '5448e5724bdc2ddf718b4568') {
        properties = {
            propertiesType: 'ItemPropertiesGlasses',
            bluntThroughput: item._props.BluntThroughput,
            class: parseInt(item._props.armorClass),
            durability: parseInt(item._props.Durability),
            repairCost: parseInt(item._props.RepairCost),
            blindnessProtection: item._props.BlindnessProtection,
            speedPenalty: parseInt(item._props.speedPenaltyPercent) / 100,
            turnPenalty: parseInt(item._props.mousePenalty) / 100,
            ergoPenalty: parseInt(item._props.weaponErgonomicPenalty),
            armor_material_id: item._props.ArmorMaterial,
        };
    } else if (hasCategory(item, ['5a341c4086f77401f2541505', '57bef4c42459772e8d35a53b', '5a341c4686f77469e155819e'])) {
        // headwear and ArmoredEquipment and FaceCover
        if (item._props.armorClass && parseInt(item._props.armorClass) > 0) {
            // armored stuff only only
            properties = {
                bluntThroughput: item._props.BluntThroughput,
                class: parseInt(item._props.armorClass),
                durability: parseInt(item._props.Durability),
                repairCost: parseInt(item._props.RepairCost),
                speedPenalty: parseInt(item._props.speedPenaltyPercent) / 100,
                turnPenalty: parseInt(item._props.mousePenalty) / 100,
                ergoPenalty: parseInt(item._props.weaponErgonomicPenalty),
                blindnessProtection: item._props.BlindnessProtection,
                ricochetX: item._props.RicochetParams.x,
                ricochetY: item._props.RicochetParams.y,
                ricochetZ: item._props.RicochetParams.z,
                armor_material_id: item._props.ArmorMaterial,
                headZones: job.addTranslation(item._props.headSegments.map(key => {
                    if (key === 'LowerNape') {
                        key = key.toLowerCase();
                    }
                    return `HeadSegment/${key}`;
                })),
                armorType: job.addTranslation(item._props.ArmorType, (lang) => {
                    if (item._props.ArmorType !== 'None') {
                        return lang[item._props.ArmorType];
                    }
                    return lang['NONE'].replace(/(?<!^|\s)\p{Lu}/gu, substr => {
                        return substr.toLowerCase();
                    });
                }),
                slots: getSlots(item),
            };
            if (hasCategory(item, ['5a341c4086f77401f2541505', '5a341c4686f77469e155819e'])) {
                properties.propertiesType = 'ItemPropertiesHelmet';
                properties.deafening = item._props.DeafStrength;
                properties.blocksHeadset = item._props.BlocksEarpiece;
            } else if (item._parent === '57bef4c42459772e8d35a53b') {
                properties.propertiesType = 'ItemPropertiesArmorAttachment';
            } 
        }
    } else if (hasCategory(item, ['5795f317245977243854e041', '5671435f4bdc2d96058b4569', '5448bf274bdc2dfc2f8b456a'])) {
        properties = {
            propertiesType: 'ItemPropertiesContainer',
            ...getGrids(item)
        };
    } else if (hasCategory(item, '5422acb9af1c889c16000029')) {
        // weapons
        properties = {
            propertiesType: 'ItemPropertiesWeapon',
            caliber: item._props.ammoCaliber,
            ergonomics: item._props.Ergonomics,
            recoilVertical: item._props.RecoilForceUp,
            recoilHorizontal: item._props.RecoilForceBack,
            repairCost: item._props.RepairCost,
            default_ammo_id: itemIds.includes(item._props.defAmmo) && !disabledItemIds.includes(item._props.defAmmo) ? item._props.defAmmo : null,
            fireRate: item._props.bFirerate,
            effectiveDistance: item._props.bEffDist,
            sightingRange: item._props.SightingRange,
            maxDurability: item._props.MaxDurability,
            centerOfImpact: item._props.CenterOfImpact,
            deviationCurve: item._props.DeviationCurve,
            deviationMax: item._props.DeviationMax,
            recoilDispersion: item._props.RecolDispersion,
            recoilAngle: item._props.RecoilAngle,
            cameraRecoil: item._props.CameraRecoil,
            cameraSnap: item._props.CameraSnap,
            convergence: item._props.Convergence,
            allowedAmmo: item._props.Chambers[0]?._props.filters[0].Filter.filter(id => {
                return itemIds.includes(id) && !disabledItemIds.includes(id);
            }) || [],
            slots: getSlots(item),
            defaultPreset: Object.values(job.presets).filter(preset => {
                return preset.default && preset.baseId === item._id;
            }).reduce((previousValue, currentValue) => {
                return currentValue.id;
            }, null),
            fireModes: job.addTranslation(item._props.weapFireType),
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
    } else if (hasCategory(item, '5448fe124bdc2da5018b4567')) {
        properties = {
            propertiesType: 'ItemPropertiesWeaponMod',
            ergonomics: item._props.Ergonomics,
            recoil: item._props.Recoil,
            recoilModifier: item._props.Recoil / 100,
            accuracyModifier: item._props.Accuracy / 100,
            slots: getSlots(item)
        };
        if (hasCategory(item, ['55818add4bdc2d5b648b456f', '55818ae44bdc2dde698b456c', '5448fe7a4bdc2d6f028b456b'])) {
            properties.propertiesType = 'ItemPropertiesScope';
            properties.zoomLevels = item._props.Zooms;
            properties.sightingRange = item._props.SightingRange;
            properties.sightModes = item._props.ModesCount;
        } else if (hasCategory(item, ['5448bc234bdc2d3c308b4569', '610720f290b75a49ff2e5e25'])) {
            properties.propertiesType = 'ItemPropertiesMagazine';
            properties.capacity = item._props.Cartridges[0]._max_count;
            properties.loadModifier = item._props.LoadUnloadModifier / 100;
            properties.ammoCheckModifier = item._props.CheckTimeModifier / 100;
            properties.malfunctionChance = item._props.MalfunctionChance;
            properties.allowedAmmo = item._props.Cartridges[0]._props.filters[0].Filter.filter(id => {
                return itemIds.includes(id) && !disabledItemIds.includes(id);
            });
        } else if (item._parent === '555ef6e44bdc2de9068b457e') {
            properties.propertiesType = 'ItemPropertiesBarrel';            
            properties.centerOfImpact = item._props.CenterOfImpact;
            properties.deviationCurve = item._props.DeviationCurve;
            properties.deviationMax = item._props.DeviationMax;
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
        let effects_damage = item._props.effects_damage;
        if (Array.isArray(effects_damage)) {
            // some effects_damage are arrays (544fb3f34bdc2d03748b456a), others are dictionaries
            effects_damage = effects_damage.reduce((effects, current) => {
                effects[current.type] = current;
                return effects;
            }, {});
        }
        properties = {
            propertiesType: 'ItemPropertiesPainkiller',
            uses: item._props.MaxHpResource | 1,
            useTime: item._props.medUseTime,
            cures: Object.keys(effects_damage).filter(status => {
                return status !== 'RadExposure';
            }),
            painkillerDuration: effects_damage.Pain.duration,
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
        properties = {
            propertiesType: 'ItemPropertiesStim',
            useTime: item._props.medUseTime,
            cures: Object.keys(item._props.effects_damage).filter(status => {
                return status !== 'RadExposure';
            }),
            stimEffects: getStimEffects(item),
        };
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
    } else if (item._parent === '5645bcb74bdc2ded0b8b4578') {
        properties = {
            propertiesType: 'ItemPropertiesHeadphone',
            ambientVolume: item._props.AmbientVolume,
            compressorAttack: item._props.CompressorAttack,
            compressorGain: item._props.CompressorGain,
            compressorRelease: item._props.CompressorRelease,
            compressorThreshold: item._props.CompressorTreshold,
            compressorVolume: item._props.CompressorVolume,
            cutoffFrequency: item._props.CutoffFreq,
            distanceModifier: item._props.RolloffMultiplier,
            distortion: item._props.Distortion,
            dryVolume: item._props.DryVolume,
            highFrequencyGain: item._props.HighFrequenciesGain,
            resonance: item._props.Resonance,
        };
    } else if (item._props.MaxResource) {
        properties = {
            propertiesType: 'ItemPropertiesResource',
            units: item._props.MaxResource,
        }
    }
    return properties;
};

module.exports = {
    setItemPropertiesOptions: setAll,
    getSpecialItemProperties: getItemProperties,
    topCategories: topCategories
};
