const fs = require('fs');
const path = require('path');

const got = require('got');

const rawData = require('../bsg-data.json');
const ttData = require('../modules/tt-data');

const mappingProperties = [
    'MaxDurability',
    'armorClass',
    'speedPenaltyPercent',
    'mousePenalty',
    'weaponErgonomicPenalty',
    'armorZone',
    'ArmorMaterial',
    'RicochetParams',
    'Weight',
    'Accuracy',
    'Recoil',
    'Loudness',
    'EffectiveDistance',
    'Ergonomics',
    'Velocity',
];

const typeMapping = {
    BlindnessProtection: [
        'glasses',
    ],
    DeafStrength: [
        'helmet',
    ],
    bFirerate: [
        'gun',
    ],
    weapFireType: [
        'gun',
    ],
    RecoilForceUp: [
        'gun',
    ],
    RecoilForceBack: [
        'gun',
    ],
    headSegments: [
        'helmet',
    ],
    ammoCaliber: [
        'gun',
    ],
    BlocksEarpiece: [
        'helmet',
    ],
};

const getGrid = (item) => {
    if(!item._props.Grids){
        return false;
    }

    const gridData = {
        pockets: [],
        totalSize: 0,
    };

    for(const grid of item._props.Grids){
        gridData.totalSize = gridData.totalSize + grid._props.cellsH * grid._props.cellsV;
        gridData.pockets.push({
            height: grid._props.cellsV,
            width: grid._props.cellsH,
        });
    }

    return gridData;
};

(async () => {
    let currentProps;

    try {
        const response = await got('https://raw.githack.com/kokarn/tarkov-tools/master/src/data/item-props.json');
        currentProps = JSON.parse(response.body);
    } catch (someError){
        console.error(someError);

        return false;
    }

    const allTTData = await ttData();
    const outputProps = {};

    for(const itemId in allTTData){
        if(!rawData[itemId]?._props){
            console.log(`No props found for ${itemId}`);

            continue;
        }

        outputProps[itemId] = {
            itemProperties: {
                Weight: rawData[itemId]._props.Weight,
                grid: getGrid(rawData[itemId]),
            },
            hasGrid: rawData[itemId]._props.Grids?.length > 0,
            linkedItems: [...new Set(rawData[itemId]._props.Slots?.map((slot) => {
                return slot._props.filters[0].Filter;
            }).flat())] || [],

        };

        for(const extraProp of mappingProperties){
            if(!rawData[itemId]._props[extraProp]){
                continue;
            }

            outputProps[itemId].itemProperties[extraProp] = rawData[itemId]._props[extraProp];
        }

        for(const typeProp in typeMapping){
            if(!rawData[itemId]._props[typeProp]){
                continue;
            }

            if(!allTTData[itemId].types.filter(type => typeMapping[typeProp].includes(type))){
                continue;
            }

            outputProps[itemId].itemProperties[typeProp] = rawData[itemId]._props[typeProp];
        }
    }

    if(JSON.stringify(currentProps) === JSON.stringify(outputProps)){
        console.log('No new or updated item props');

        return true;
    }

    console.log(`New or updated props written to item-props.json`);
    fs.writeFileSync(path.join(__dirname, '..', 'item-props.json'), JSON.stringify(outputProps, null, 4));
})();