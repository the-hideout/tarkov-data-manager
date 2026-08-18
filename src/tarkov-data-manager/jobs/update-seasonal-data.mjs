import sharp from 'sharp';

import DataJob from '../modules/data-job.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import { getLocalBucketContents, uploadAnyImage } from '../modules/upload-s3.mjs';

class UpdateSeasonalDataJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-seasonal-data', loadLocales: true});
    }

    run = async () => {
        const apiData = {
            perks: {
                common: [],
                personal: [],
            },
        };
        const perks = await tarkovData.seasonalPerks({download: true});
        this.s3Images = getLocalBucketContents();
        this.imageActions = [];
        for (const perkType in apiData.perks) {
            for (const perk of perks[perkType]) {
                apiData.perks[perkType].push(await this.processPerk(perk));
            }
        }
        const imageResults = await Promise.allSettled(this.imageActions);
        for (const result of imageResults) {
            if (result.status === 'fulfilled') {
                continue;
            }
            this.logger.error(`Error getting image: ${result.reason}`);
        }
        await this.r2Put(`pvp-season/season`,
            {data: apiData, translations: [
                '$.data.perks.*.*.name',
                '$.data.perks.*.*.description',
            ]},
            {locale: await this.fillTranslations()},
        );
    }

    processPerk(p) {
        const perk = {
            id: p.id,
            name: this.addTranslation(`${p.id} name`),
            description: this.addTranslation(`${p.id} description`, (locale, lang) => {
                const key = `${p.id} description`;
                let translated = locale[key] ?? this.locales.en[key] ?? key;
                return translated.replace(/^• /gm, '');
            }),
            points: p.points,
            exclusiveToPerks: p.mutuallyExclusiveSeasonalPerkIds,
        };
        this.imageActions.push(this.getPerkImageLink(p).then(imageUrl => {
            perk.imageLink = imageUrl;
        }));
        return perk;
    }

    async getPerkImageLink(perk) {
        const s3FileName = `${perk.id}.webp`;
        const s3ImageLink = `https://${process.env.S3_BUCKET}/${s3FileName}`;
        if (this.s3Images.includes(s3FileName)) {
            return s3ImageLink;
        }
        let image = await this.getImageFromEFT(perk);
        if (!image) {
            image = await this.getImageFromFence(perk);
        }
        if (!image) {
            return null;
        }
        await uploadAnyImage(image, s3FileName, 'image/webp');
        return s3ImageLink;
    }

    async getImageFromEFT(perk) {
        this.logger.log('Attempting to get image from EFT');
        if (!perk?.imageUrl) {
            return;
        }
        const imageResponse = await fetch(`https://s3-prod.escapefromtarkov.com/pvp-season${perk.imageUrl}`);
        if (!imageResponse.ok) {
            return;
        }
        const image = sharp(await imageResponse.arrayBuffer()).webp({lossless: true});
        const metadata = await image.metadata();
        if (metadata.width <= 1 || metadata.height <= 1) {
            return;
        }
        this.logger.log(`Retrieved ${this.locales.en[`${perk.id} name`]} ${perk.id} image from EFT`);
        return image;
    }

    async getImageFromFence(perk) {
        this.logger.log('Attempting to get image from Fence');
        if (!perk?.imageUrl) {
            return;
        }
        if (!process.env.FENCE_BASIC_AUTH) {
            return;
        }
        const imageResponse = await this.fencePassthrough(`https://s3-prod.escapefromtarkov.com/pvp-season${perk.imageUrl}`);
        if (!imageResponse.ok) {
            return;
        }
        const image = sharp(await imageResponse.arrayBuffer()).webp({lossless: true});
        const metadata = await image.metadata();
        if (metadata.width <= 1 || metadata.height <= 1) {
            return;
        }
        this.logger.log(`Retrieved ${this.locales.en[`${perk.id} name`]} ${perk.id} image from Fence`);
        return image;
    }
}

export default UpdateSeasonalDataJob;
