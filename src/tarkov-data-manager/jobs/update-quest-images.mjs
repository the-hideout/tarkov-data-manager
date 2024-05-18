import fs from 'node:fs/promises';

import cheerio from 'cheerio';
import sharp from 'sharp';

import DataJob from '../modules/data-job.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import { getLocalBucketContents, uploadAnyImage } from '../modules/upload-s3.mjs';

class UpdateQuestImagesJob extends DataJob {
    constructor() {
        super('update-quest-images');
    }

    async run() {
        [this.eftQuests, this.locales, this.quests, this.missingImages] = await Promise.all([
            tarkovData.quests(),
            tarkovData.locales(),
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

        questLoop: for (const id of this.missingImages) {
            const s3FileName = `${id}.webp`;
            if (this.s3Images.includes(s3FileName)) {
                this.logger.warn(`Image already exists for ${this.locales.en[`${id} name`]} ${id}`);
                continue;
            }
            const task = this.quests.find(t => t.id === id);
            if (!task) {
                this.logger.error(`Task ${this.locales.en[`${id} name`]} ${id} was not found`);
                continue;
            }
            let imagePath = false;
            const questData = this.eftQuests[id];
            if (questData) {
                imagePath = questData.image;
            }
            if (imagePath) {
                const imageId = imagePath.replace('/files/quest/icon/', '').split('.')[0];
                const extensions = ['.png', '.jpg'];
                for (const ext of extensions) {
                    try {
                        const response = await fetch(`https://dev.sp-tarkov.com/SPT-AKI/Server/raw/branch/master/project/assets/images/quests/${imageId}${ext}`);
                        if (!response.ok) {
                            continue;
                        }
                        const image = sharp(await response.arrayBuffer()).webp({lossless: true});
                        const metadata = await image.metadata();
                        if (metadata.width <= 1 || metadata.height <= 1) {
                            continue;
                        }
                        await uploadAnyImage(image, s3FileName, 'image/webp');
                        this.logger.log(`Retrieved ${this.locales.en[`${id} name`]} ${id} image from SPT`);
                        continue questLoop;
                    } catch (error) {
                        this.logger.error(`Error fetching ${imageId}.${ext} from SPT: ${error.stack}`);
                    }
                }
            }
            if (!task.wikiLink) {
                continue;
            }
            const pageResponse = await fetch(task.wikiLink).catch(error => {
                this.logger.error(`Error fetching wiki page for ${this.locales.en[`${task.id} name`]} ${this.task.id}: ${error}`);
                return {
                    ok: false,
                };
            });//.then(response => cheerio.load(response.body));
            if (!pageResponse.ok) {
                continue;
            }
            const $ = cheerio.load(await pageResponse.text());
            const imageUrl = $('.va-infobox-mainimage-image img').first().attr('src');
            const imageResponse = await fetch(imageUrl);
            if (!imageResponse.ok) {
                continue;
            }
            const image = sharp(await imageResponse.arrayBuffer()).webp({lossless: true});
            const metadata = await image.metadata();
            if (metadata.width <= 1 || metadata.height <= 1) {
                continue;
            }
            await uploadAnyImage(image, s3FileName, 'image/webp');
            this.logger.log(`Retrieved ${this.locales.en[`${task.id} name`]} ${task.id} image from wiki`);
        }
    }
}

export default UpdateQuestImagesJob;
