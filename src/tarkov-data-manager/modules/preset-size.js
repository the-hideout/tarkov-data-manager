const tarkovChanges = require('../modules/tarkov-changes');

let itemData = false;
let credits = false;

const getPresetSize = async (item, logger = false) => {
    if(!itemData){
        itemData = await tarkovChanges.items();
    }
    if (!credits) {
        credits = await tarkovChanges.credits();
    }

    const directions = [
        'Left',
        'Right',
        'Up',
        'Down',
    ];

    const softSizes = {Left: 0, Right: 0, Up: 0, Down: 0};
    const hardSizes = {Left: 0, Right: 0, Up: 0, Down: 0};
    const baseItem = item.baseId ? itemData[item.baseId] : itemData[item.id];
    if (!baseItem) {
        if (logger) logger.warn(`Could not find a base item to calculate size for ${item.id}`);
        return false;
    }

    let weight = baseItem._props.Weight;
    let baseValue = credits[baseItem._id];
    for (const contained of item.containsItems) {
        const part = itemData[contained.item.id];

        if(!part){
            if (logger) logger.warn(`Could not find part ${contained.item.id} of preset ${item.id}`);
            continue;
        }
        if (part._id === baseItem._id) continue;

        for (const di in directions) {
            const dir = directions[di];
            if (part._props.ExtraSizeForceAdd) {
                hardSizes[dir] += part._props[`ExtraSize${dir}`];
            } else {
                if (part._props[`ExtraSize${dir}`] > softSizes[dir]) {
                    softSizes[dir] = part._props[`ExtraSize${dir}`];
                }
            }
        }
        weight += (part._props.Weight * contained.count);
        if (credits[part._id]) {
            baseValue += (credits[part._id] * contained.count);
        } else {
            if (logger) logger.warn(`Could not find base value for part ${contained.item.id} of preset ${item.id}`);
        }
    }

    return {
        width: baseItem._props.Width + softSizes.Left + softSizes.Right + hardSizes.Left + hardSizes.Right,
        height: baseItem._props.Height + softSizes.Up + softSizes.Down + hardSizes.Up + hardSizes.Down,
        weight : Math.round(weight * 100) / 100,
        baseValue: baseValue
    };
};

module.exports = {
    initPresetSize:( bsgItemsData, creditsData) => {
        itemData = bsgItemsData;
        credits = creditsData;
    },
    getPresetSize: getPresetSize
}