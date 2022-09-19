const fs = require('fs');
const path = require('path');

const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const {fromEnv} = require('@aws-sdk/credential-provider-env');
const { imageSizes } = require('tarkov-dev-image-generator');

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
    const logger = new JobLogger('update-existing-bases');
    try {
        const itemData = await remoteData.get();

        const activeItems = [...itemData.values()].filter(item => !item.types.includes('disabled'));

        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            logger.log('aws variables not configured; skipping update-existing-bases job');
            logger.end();
            return;
        }
        const allKeys = await getBucketContents();

        const baseKeys = [];

        let deadLinks = 0;

        for (item of activeItems) {
            for (const key in imageSizes) {
                const imgSize = imageSizes[key];
                if (item[imgSize.field]) {
                    if (!allKeys.includes(item[imgSize.field])) {
                        deadLinks++;
                        logger.warn(`${item.name} ${item.id} ${imgSize.field} has no corresponding image in S3`);
                    }
                }
            }
            if (item.base_image_link) {
                baseKeys.push(item.id);
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
