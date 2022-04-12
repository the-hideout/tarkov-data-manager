const fs = require('fs');
const path = require('path');

const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const {fromEnv} = require('@aws-sdk/credential-provider-env');

const JobLogger = require('../modules/job-logger');

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
        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            logger.log('aws variables not configured; skipping update-existing-bases job');
            logger.end();
            return;
        }
        const allKeys = await getBucketContents();

        const baseKeys = allKeys.filter(key => key.includes('-base')).map(key => key.split('-')[0]);

        fs.writeFileSync(path.join(__dirname, '..', 'public', 'data', 'existing-bases.json'), JSON.stringify(baseKeys, null, 4));
    } catch (err) {
        logger.error(err);
    }
    logger.end();
}