const fs = require('fs');
const path = require('path');

const got = require('got');

let presets = false;
let itemData = false;

module.exports = async(itemId) => {
    if(!itemData){
        itemData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bsg-data.json')));
    }

    if(!presets){
        try {
            presets = JSON.parse((await got('https://raw.githack.com/TarkovTracker/tarkovdata/master/item_presets.json')).body);
        } catch (error) {
            console.log(error);

            return false;
        }
    }

    const directions = [
        'Left',
        'Right',
        'Up',
        'Down',
    ];

    for (const presetId in presets) {
        const softSizes = {Left: 0, Right: 0, Up: 0, Down: 0};
        const hardSizes = {Left: 0, Right: 0, Up: 0, Down: 0};
        const preset = presets[presetId];
        const baseItem = itemData[preset.baseId];

        if (itemId !== presetId && !(itemId === preset.baseId && preset.default)) {
            continue;
        }

        for (let i = 0; i < preset.parts.length; i++) {
            const part = itemData[preset.parts[i].id];

            if(!part){
                console.log(preset.parts[i]);
                console.log(preset);
                continue;
            }

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
        }

        return {
            width: baseItem._props.Width + softSizes.Left + softSizes.Right + hardSizes.Left + hardSizes.Right,
            height: baseItem._props.Height + softSizes.Up + softSizes.Down + hardSizes.Up + hardSizes.Down,
        };
    }

    return false;
}