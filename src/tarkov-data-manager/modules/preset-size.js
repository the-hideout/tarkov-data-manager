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
    let ergo = baseItem._props.Ergonomics;
    const baseVerticalRecoil = baseItem._props.RecoilForceUp;
    const baseHorizontalRecoil = baseItem._props.RecoilForceBack;
    let vRecoil = baseVerticalRecoil;
    let hRecoil = baseHorizontalRecoil;
    let centerOfImpact = baseItem._props.CenterOfImpact;
    let barrelDeviationMax = 100.0;
    for (const contained of item.containsItems) {
        let partId = contained.item;
        if (typeof partId === 'object') partId = partId.id;
        const part = itemData[partId];

        if(!part){
            if (logger) logger.warn(`Could not find part ${partId} of preset ${item.id}`);
            continue;
        }
        if (part._id === baseItem._id) continue;

        for (const dir of directions) {
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
            if (logger) logger.warn(`Could not find base value for part ${partId} of preset ${item.id}`);
        }
        ergo += part._props.Ergonomics;
        vRecoil += (baseVerticalRecoil * (part._props.Recoil / 100));
        hRecoil += (baseHorizontalRecoil * (part._props.Recoil / 100));
        if (part._props.DeviationMax) {
            barrelDeviationMax = part._props.DeviationMax;
        }
        if (!isNaN(part._props.CenterOfImpact)) {
            centerOfImpact += parseFloat(part._props.CenterOfImpact);
        }
    }

    const getBarrelDeviation = (durability = 100.0) => {
        const deviationCurve = baseItem._props.DeviationCurve;
        const num = 2.0 * deviationCurve;
        const num2 = ((100.0 - num === 0) ? durability / num : (((deviationCurve * -1) + Math.sqrt(((num * -1) + 100.0) * durability + deviationCurve)) / ((num * -1) + 100.0)));
        const num3 = 1.0 - num2;
        return num3 * num3 * barrelDeviationMax + 2.0 * num2 * num3 * deviationCurve + num2 * num2;
    };
    const moa = centerOfImpact * getBarrelDeviation() * 100.0 / 2.9089;

    return {
        width: baseItem._props.Width + softSizes.Left + softSizes.Right + hardSizes.Left + hardSizes.Right,
        height: baseItem._props.Height + softSizes.Up + softSizes.Down + hardSizes.Up + hardSizes.Down,
        weight : Math.round(weight * 1000) / 1000,
        baseValue: baseValue,
        ergonomics: ergo,
        verticalRecoil: Math.round(vRecoil),
        horizontalRecoil: Math.round(hRecoil),
        moa: Math.round(moa * 100) / 100,
    };
};

module.exports = {
    initPresetSize:( bsgItemsData, creditsData) => {
        itemData = bsgItemsData;
        credits = creditsData;
    },
    getPresetSize: getPresetSize
}