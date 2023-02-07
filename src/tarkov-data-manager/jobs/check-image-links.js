const fs = require('fs');
const path = require('path');

const { imageFunctions } = require('tarkov-dev-image-generator');

const remoteData = require('../modules/remote-data');
const DataJob = require('../modules/data-job');
const { getBucketContents } = require('../modules/upload-s3');

class CheckImageLinksJob extends DataJob {
    constructor() {
        super('check-image-links');
    }

    async run() {
        const itemData = await remoteData.get();

        const activeItems = [...itemData.values()].filter(item => !item.types.includes('disabled'));

        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            this.logger.log('aws variables not configured; skipping check-image-links job');
            this.logger.end();
            return;
        }
        const allKeys = await getBucketContents();

        this.logger.log(`Retrieved ${allKeys.length} S3 bucket images`);

        const baseKeys = [];

        let deadLinks = 0;
        let oldImages = 0;

        const imageSizes = imageFunctions.imageSizes;

        for (const item of activeItems) {
            for (const key in imageSizes) {
                const imgSize = imageSizes[key];
                if (item[imgSize.field]) {
                    const filename = item[imgSize.field].replace(`https://${process.env.S3_BUCKET}/`, '');
                    if (!allKeys.includes(filename)) {
                        deadLinks++;
                        logger.warn(`${item.name} ${item.id} ${imgSize.field} has no corresponding image in S3`);
                    }
                }
            }
            if (item.base_image_link) {
                baseKeys.push(item.id);
            }
        }

        for (const filename of allKeys) {
            const id = filename.split('-')[0];
            if (id.length !== 24) {
                continue;
            }
            const appendType = filename.replace(`${id}-`, '').split('.')[0];
            let imgType = false;
            for (const typeKey in imageSizes) {
                imgType = imageSizes[typeKey];
                if (imgType.append === appendType) {
                    break;
                }
                imgType = false;
            }
            if (!imgType) {
                //this.logger.warn(`Unrecognized image type ${appendType} for ${filename}`);
                continue;
            }
            const item = itemData.get(id);
            if (!item) {
                this.logger.warn(`Could not find item with id ${id}`);
                continue;
            }
            const imageLink = item[imgType.field];
            if (!imageLink) {
                this.logger.warn(`Item ${item.name} ${item.id} does not have ${imgType.field}, but image exists in S3`);
                continue;
            }
            if (imageLink !== `https://${process.env.S3_BUCKET}/${filename}`) {
                //this.logger.warn(`Item ${item.name} ${item.id} ${imgType.field} ${item[imgType.field]} does not match filename in S3 ${filename}`);
                oldImages++;
            }
        }

        this.logger.log(`${deadLinks} dead item image links found`);
        this.logger.log(`${oldImages} old item image links found`);
        this.logger.log(`${baseKeys.length} of ${activeItems.length} active items have base images`);
        fs.writeFileSync(path.join(__dirname, '..', 'public', 'data', 'existing-bases.json'), JSON.stringify(baseKeys, null, 4));
    }
}

module.exports = CheckImageLinksJob;
