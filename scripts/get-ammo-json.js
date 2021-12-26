const fs = require('fs');
const path = require('path');

const got = require('got');

const ttData = require('../modules/tt-data');

const rawToFormat = function(rawItem) {
    return {
        "id": rawItem._id,
        "name": rawItem._props.Name,
        "shortName": rawItem._props.ShortName,
        "weight": rawItem._props.Weight,
        "caliber": rawItem._props.Caliber,
        "stackMaxSize": rawItem._props.StackMaxSize,
        "tracer": rawItem._props.Tracer,
        "tracerColor": rawItem._props.TracerColor,
        "ammoType": rawItem._props.ammoType,
        "projectileCount": rawItem._props.ProjectileCount,
        "ballistics": {
            "damage": rawItem._props.Damage,
            "armorDamage": rawItem._props.ArmorDamage,
            "fragmentationChance": rawItem._props.FragmentationChance,
            "ricochetChance": rawItem._props.RicochetChance,
            "penetrationChance": rawItem._props.PenetrationChance,
            "penetrationPower": rawItem._props.PenetrationPower,
            "accuracy": rawItem._props.ammoAccr,
            "recoil": rawItem._props.ammoRec,
            "initialSpeed": rawItem._props.InitialSpeed
        }
    };
};

(async() => {
    const response = await got('https://raw.githack.com/TarkovTracker/tarkovdata/master/ammunition.json', {
        responseType: 'json',
    });

    const allTTItems = await ttData();

    const allAmmoItems = [];

    for(const itemId in allTTItems){
        if(!allTTItems[itemId].types.includes('ammo')){
            continue;
        }

        allAmmoItems.push(itemId);
    }

    const currentData = response.body;
    const bsgData = require('../bsg-data.json');

    const outputData = {};

    for(const key in currentData){
        outputData[key] = rawToFormat(bsgData[key]);

        allAmmoItems.splice(allAmmoItems.indexOf[key], 1);
    }

    for(const newAmmoId of allAmmoItems){
        outputData[newAmmoId] = rawToFormat(bsgData[newAmmoId]);
    }

    if(JSON.stringify(outputData) === JSON.stringify(currentData)){
        console.log(`No new ammo data available`);

        return true;
    }

    console.log('Some ammunition has been updated. New ammo file written to ammunition.json');
    fs.writeFileSync(path.join(__dirname, '..', 'ammunition.json'), JSON.stringify(outputData, null, 2));
})();
