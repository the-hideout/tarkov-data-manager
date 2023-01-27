const fs = require('fs');
const path = require('path');

const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { imageFunctions } = require('tarkov-dev-image-generator');

const remoteData = require('../modules/remote-data');
const DataJob = require('../modules/data-job');
const { client: s3 } = require('../modules/upload-s3');

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

        const baseKeys = [];

        let deadLinks = 0;

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
                this.logger.warn(`Unrecognized image type ${appendType} for ${filename}`);
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
                this.logger.warn(`Item ${item.name} ${item.id} ${imgType.field} ${item[imgType.field]} does not match filename is S3 ${filename}`);
            }
        }

        this.logger.log(`${deadLinks} dead image links found`);
        this.logger.log(`${baseKeys.length} of ${activeItems.length} active items have base images`);
        fs.writeFileSync(path.join(__dirname, '..', 'public', 'data', 'existing-bases.json'), JSON.stringify(baseKeys, null, 4));
    }
}

const getBucketContents = async (continuationToken = false) => {
    const input = {
        Bucket: process.env.S3_BUCKET,
    };

    if(continuationToken){
        input.ContinuationToken = continuationToken;
    }

    console.log('Loading 1000 items');

    let responseKeys = [];

    const command = new ListObjectsV2Command(input);
    const response = await s3.send(command);

    responseKeys = response.Contents.map(item => item.Key);

    if(response.NextContinuationToken){
        responseKeys = responseKeys.concat(await getBucketContents(response.NextContinuationToken));
    }

    return responseKeys;
}

module.exports = CheckImageLinksJob;
