const tarkovChanges = require('../modules/tarkov-changes');

let locales = false;

const getItemProperties = async (item, loc = false) => {
    if (loc) {
        locales = loc;
    } else if (!locales) {
        locales = await tarkovChanges.locales();
    }
    let properties = null;
    if (item._parent === '5485a8684bdc2da71d8b4567') {
        //ammo
        properties = {
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
    }
    return properties;
};

module.exports = getItemProperties;