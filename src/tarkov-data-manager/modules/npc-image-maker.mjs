import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import tarkovDevData from './tarkov-data-tarkov-dev.mjs';

const customImageData = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'npc_images.json')));

const npcImageMaker = {
    requestImage: async(requestData) => {
        /*const url = new URL(`https://imagemagic.tarkov.dev/player/${requestData.aid}.webp`);
        url.searchParams.append('data', JSON.stringify(requestData));
        const imageResponse = await fetch(url);
        if (!imageResponse.ok) {
            this.logger.warn(`Error retrieving ${bossInfo.normalizedName} image: ${imageResponse.status} ${imageResponse.statusText}`);
            return;
        }
        const image = sharp(await imageResponse.arrayBuffer());*/
        const image = await tarkovDevData.fenceFetchImage('/profile-image?scale=1', {
            method: 'POST',
            body: JSON.stringify(requestData),
        });
        const metadata = await image.metadata();
        if (metadata.width <= 1 || metadata.height <= 1) {
            return;
        }
        return image;
    },
    defaultData: () => {
        return {
            aid: 1234567890,
            customization: {},
            equipment: {
                Id: "000000000000000000000000",
                Items: [
                    {
                        _id: "000000000000000000000000",
                        _tpl: "55d7217a4bdc2d86028b456d"
                    }
                ],
            },
        };
    },
    hasCustomData: (key) => {
        return !!customImageData[key];
    },
    getCustomData: (key) => {
        const customData = customImageData[key];
        if (!customData) {
            return;
        }
        const data = npcImageMaker.defaultData();
        data.customization = customData.customization;
        data.equipment.Items.push(...customData.items);
        return data;
    },
};

export default npcImageMaker;
