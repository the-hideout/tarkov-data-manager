const ttData = require('../modules/tt-data');
const BSGData = require('../bsg-data.json');

const types = {};

const mappedTypes = {
    pistolGrip: {
        keys: [
            'mod_pistol_grip',
            'mod_pistolgrip',
            'mod_pistol_grip_akms',
        ],
    },
    backpacks: {
        keys: [
            'Backpack',
        ],
    },
    armor: {
        keys: [
            'ArmorVest',
        ],
    },
    rig: {
        keys: [
            'TacticalVest',
            'Scabbard',
        ],
    },
    gun: {
        keys: [
            'FirstPrimaryWeapon',
            'SecondPrimaryWeapon',
        ],
    },
    glasses: {
        keys: [
            'Eyewear',
        ],
    },
    headphones: {
        keys: [
            'Earpiece'
        ],
    },
};

(async () => {
    const allTTData = await ttData();

    for(const itemId in BSGData){
        if(!BSGData[itemId]?._props.Slots){
            continue;
        }

        for(const slot of BSGData[itemId]?._props.Slots){
            if(!types[slot._name]){
                types[slot._name] = [];
            }

            for(const linkedItemId of slot._props.filters[0].Filter){
                types[slot._name].push(linkedItemId);
            }
        }
    }

    for(const type in types){
        types[type] = [...new Set(types[type])];
    }

    for(const ttType in mappedTypes){
        mappedTypes[ttType].items = [];

        for(const key of mappedTypes[ttType].keys){
            mappedTypes[ttType].items = mappedTypes[ttType].items.concat(types[key]);
        }

        mappedTypes[ttType].items = [... new Set(mappedTypes[ttType].items)];
    }

    for(const ttType in mappedTypes){
        for(const linkedItemId of mappedTypes[ttType].items){
            // Parent items etc
            if(!allTTData[linkedItemId]){
                continue;
            }

            if(allTTData[linkedItemId]?.types.includes(ttType)){
                continue;
            }

            console.log(`${allTTData[linkedItemId]?.name || linkedItemId} is missing ${ttType}`);
        }
    }
})();