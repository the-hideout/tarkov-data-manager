const fs = require('fs');
const path = require('path');

const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const {fromEnv} = require('@aws-sdk/credential-provider-env');
const { imageFunctions } = require('tarkov-dev-image-generator');

const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const { jobComplete } = require('../modules/db-connection');
const remoteData = require('../modules/remote-data');

const s3 = new S3Client({
    region: 'us-east-1',
    credentials: fromEnv(),
});

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

module.exports = async () => {
    const logger = new JobLogger('check-image-links');
    try {
        const itemData = await remoteData.get();

        const activeItems = [...itemData.values()].filter(item => !item.types.includes('disabled'));

        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            logger.log('aws variables not configured; skipping check-image-links job');
            logger.end();
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
                logger.warn(`Unrecognized image type ${appendType} for ${filename}`);
                continue;
            }
            const item = itemData.get(id);
            if (!item) {
                logger.warn(`Could not find item with id ${id}`);
                continue;
            }
            const imageLink = item[imgType.field];
            if (!imageLink) {
                logger.warn(`Item ${item.name} ${item.id} does not have ${imgType.field}, but image exists in S3`);
                continue;
            }
            if (imageLink !== `https://${process.env.S3_BUCKET}/${filename}`) {
                logger.warn(`Item ${item.name} ${item.id} ${imgType.field} ${item[imgType.field]} does not match filename is S3 ${filename}`);
            }
        }

        logger.log(`${deadLinks} dead image links found`);
        logger.log(`${baseKeys.length} of ${activeItems.length} active items have base images`);
        fs.writeFileSync(path.join(__dirname, '..', 'public', 'data', 'existing-bases.json'), JSON.stringify(baseKeys, null, 4));
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
    await jobComplete();
}
