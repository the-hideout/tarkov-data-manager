import fs from 'node:fs/promises';

import * as cheerio from 'cheerio';
import sharp from 'sharp';

import DataJob from '../modules/data-job.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import tarkovSpt from '../modules/tarkov-spt.mjs';
import { getLocalBucketContents, uploadAnyImage } from '../modules/upload-s3.mjs';

class UpdateQuestImagesJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-quest-images'});
    }

    async run() {
        [this.eftQuests, this.localeEn, this.quests, this.missingImages] = await Promise.all([
            tarkovData.quests(),
            tarkovData.locale('en'),
            this.jobManager.jobOutput('update-quests', this),
            fs.readFile('./cache/quests_missing_images.json').then(fileString => {
                return JSON.parse(fileString);
            }).catch(error => {
                if (error.code !== 'ENOENT') {
                    this.logger.error(`Error reading quests_missing_images.json: ${error}`);
                }
                return [];
            }),
        ]);

        this.s3Images = getLocalBucketContents();

        this.logger.log(`${this.missingImages.length} quests are missing images`);

        for (const id of this.missingImages) {
            const s3FileName = `${id}.webp`;
            if (this.s3Images.includes(s3FileName)) {
                this.logger.warn(`Image already exists for ${this.localeEn[`${id} name`]} ${id}`);
                continue;
            }
            const task = this.quests.find(t => t.id === id);
            if (!task) {
                this.logger.error(`Task ${this.localeEn[`${id} name`]} ${id} was not found`);
                continue;
            }
            const questData = this.eftQuests[id];
            let image = await this.getFromEFT(questData);
            if (!image) {
                image = await this.getFromFence(id);
            }
            if (!image) {
                image = await this.getFromSPT(questData);
            }
            if (!image) {
                image = await this.getFromWiki(task);
            }
            
            if (!image) {
                continue;
            }
            
            await uploadAnyImage(image, s3FileName, 'image/webp');
        }
    }

    async getFromEFT(questData) {
        if (!questData?.image) {
            return;
        }
        const imageResponse = await fetch(`https://prod.escapefromtarkov.com${questData.image}`);
        if (!imageResponse.ok) {
            return;
        }
        const image = sharp(await imageResponse.arrayBuffer()).webp({lossless: true});
        const metadata = await image.metadata();
        if (metadata.width <= 1 || metadata.height <= 1) {
            return;
        }
        this.logger.log(`Retrieved ${this.localeEn[`${questData._id} name`]} ${questData._id} image from EFT`);
        return image;
    }

    async getFromFence(id) {
        if (!process.env.FENCE_BASIC_AUTH) {
            return;
        }
        const imageResponse = await fetch(`https://fence.tarkov.dev/task-image/${id}`, {
            headers: {
                'Authorization': `Basic ${process.env.FENCE_BASIC_AUTH}`,
            },
        });
        if (!imageResponse.ok) {
            return;
        }
        const image = sharp(await imageResponse.arrayBuffer()).webp({lossless: true});
        const metadata = await image.metadata();
        if (metadata.width <= 1 || metadata.height <= 1) {
            return;
        }
        this.logger.log(`Retrieved ${this.localeEn[`${id} name`]} ${id} image from Fence`);
        return image;
    }

    async getFromSPT(questData) {
        if (!questData?.image) {
            return;
        }
        const image = await tarkovSpt.getImage(questData.image);
        if (!image) {
            return false;
        }
        this.logger.log(`Retrieved ${this.localeEn[`${questData._id} name`]} ${questData._id} image from SPT`);
        return image;
    }

    async getFromWiki(task) {
        if (!task?.wikiLink) {
            return;
        }
        const pageResponse = await fetch(task.wikiLink).catch(error => {
            this.logger.error(`Error fetching wiki page for ${this.localeEn[`${task.id} name`]} ${this.task.id}: ${error}`);
            return {
                ok: false,
            };
        });
        if (!pageResponse.ok) {
            return;
        }
        const $ = cheerio.load(await pageResponse.text());
        const imageUrl = $('.va-infobox-mainimage-image img').first().data('src');
        if (!imageUrl) {
            return;
        }
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            return;
        }
        const image = sharp(await imageResponse.arrayBuffer()).webp({lossless: true});
        const metadata = await image.metadata();
        if (metadata.width <= 1 || metadata.height <= 1) {
            return;
        }
        this.logger.log(`Retrieved ${this.localeEn[`${task.id} name`]} ${task.id} image from wiki`);
        return image;
    }
}

export default UpdateQuestImagesJob;
