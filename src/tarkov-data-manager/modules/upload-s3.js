const fs = require('fs');
const path = require('path');

const sharp = require('sharp');
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand, Delete } = require("@aws-sdk/client-s3");
const {fromEnv} = require('@aws-sdk/credential-provider-env');

const cloudflare = require('./cloudflare');
const { imageFunctions } = require('tarkov-dev-image-generator');
const { imageSizes } = imageFunctions;

const remoteData = require('./remote-data');

const s3 = new S3Client({
    region: 'us-east-1',
    credentials: fromEnv(),
});

sharp.cache( { files: 0 } );

async function uploadAnyImage(image, filename, contentType) {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        return Promise.reject(new Error('aws variables not configured; image upload disabled'));
    }

    const uploadParams = {
        Bucket: process.env.S3_BUCKET,
        Key: filename,
        ContentType: contentType,
        Body: await image.toBuffer()
    };
    await s3.send(new PutObjectCommand(uploadParams));
}

async function upload(image, imageType, id) {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        return Promise.reject(new Error('aws variables not configured; image upload disabled'));
    }
    const typeInfo = imageSizes[imageType];
    if (!typeInfo) {
        return Promise.reject(new Error(`${imageType} is not a valid image type`));
    }

    if (typeof image === 'string') {
        image = sharp(image);
        if(!image){
            return Promise.reject(new Error('Failed to load image'));
        }
        if (typeInfo.format === 'jpg') {
            image.jpeg({quality: 100});
        } else if (typeInfo.format === 'png') {
            image.png({compressionLevel: 9});
        } else if (typeInfo.format === 'webp') {
            image.webp({lossless: true});
        }
    }
        
    const uploadParams = {
        Bucket: process.env.S3_BUCKET,
        Key: `${id}-${imageType}.${typeInfo.format}`,
        ContentType: typeInfo.contentType,
        Body: await image.toBuffer()
    };
    await s3.send(new PutObjectCommand(uploadParams));
    console.log(`${id} ${imageType} saved to s3`);
    const imageLink = `https://${uploadParams.Bucket}/${uploadParams.Key}`;
    let purgeNeeded = false;
    if (typeInfo.field) {
        purgeNeeded = !Boolean(await remoteData.setProperty(id, typeInfo.field, imageLink));
    }
    if (purgeNeeded) {
        await cloudflare.purgeCache(imageLink);
        return true;
    } else {
        addToLocalBucket(imageLink);
    }
    return false;
}

async function downloadFromId(item) {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        return Promise.reject(new Error('aws variables not configured; image download disabled'));
    }
    if (typeof item === 'string') {
        allItems = await remoteData.get();
        item = allItems.get(item);
    }
    const imageRequests = [];
    const errors = [];
    const requestedFiles = [];
    for (const imageType in imageSizes) {
        const typeInfo = imageSizes[imageType];
        const input = {
            Bucket: process.env.S3_BUCKET,
        };
        const filename = `${item.id}-${imageType}.${typeInfo.format}`;
        if (requestedFiles.includes(filename)) {
            continue;
        }
        if (typeInfo.field && item[typeInfo.field]) {
            input.Key = filename;
        }
        if (!input.Key) 
            continue;
        imageRequests.push(s3.send(new GetObjectCommand(input)).then(response => {
            const stream = response.Body;
            return new Promise((resolve, reject) => {
                const _buf = [];
                stream.on("data", chunk => _buf.push(chunk));
                stream.on("end", () => resolve({buffer: Buffer.concat(_buf), filename: filename}));
                stream.on("error", err => reject(`error converting stream - ${err}`));
            });
        }).catch(error => {
            errors.push(`${filename}: ${error}`);
            return false;
        }));
        requestedFiles.push(filename);
    }
    const imageResponses = (await Promise.all(imageRequests)).filter(Boolean);
    return {images: imageResponses, errors: errors};
}

async function fileExistsInS3(filename) {
    const input = {
        Bucket: process.env.S3_BUCKET,
        Key: filename,
    };
    try {
        await s3.send(new HeadObjectCommand(input));
        return true;
    } catch (error) {
        if (error.name === 'NotFound') {
            console.log(filename, 'not found')
            return false;
        }
        return Promise.reject(error);
    }
}

const getBucketContents = async (continuationToken = false) => {
    const input = {
        Bucket: process.env.S3_BUCKET,
    };

    if(continuationToken){
        input.ContinuationToken = continuationToken;
    }

    let responseKeys = [];

    const command = new ListObjectsV2Command(input);
    const response = await s3.send(command);

    responseKeys = response.Contents.map(item => item.Key);

    if(response.NextContinuationToken){
        responseKeys = responseKeys.concat(await getBucketContents(response.NextContinuationToken));
    }

    fs.writeFileSync(path.join(__dirname, '..', 'cache', 's3-bucket-contents.json'), JSON.stringify(responseKeys, null, 4));
    return responseKeys;
}

const getLocalBucketContents = () => {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cache', 's3-bucket-contents.json')));
    } catch (error) {
        return [];
    }
};

const addToLocalBucket = filename => {
    const contents = getLocalBucketContents();
    if (!contents.includes(filename)) {
        contents.push(filename);
        fs.writeFileSync(path.join(__dirname, '..', 'cache', 's3-bucket-contents.json'), JSON.stringify(contents, null, 4));
    }
};

const removeFromLocalBucket = filename => {
    let contents = getLocalBucketContents();
    if (contents.includes(filename)) {
        contents = contents.filter(fn => fn !== filename);
        fs.writeFileSync(path.join(__dirname, '..', 'cache', 's3-bucket-contents.json'), JSON.stringify(contents, null, 4));
    }
};

async function addFileToBucket(localFilePath, fileName) {
    const uploadParams = {
        Bucket: process.env.S3_BUCKET,
        Key: fileName,
        //ContentType: typeInfo.contentType,
        Body: fs.readFileSync(localFilePath)
    };
    const fileExists = await fileExistsInS3(fileName);
    await s3.send(new PutObjectCommand(uploadParams));
    if (fileExists) {
        await cloudflare.purgeCache(fileName);
    }
    addToLocalBucket(fileName);
}

async function deleteFromBucket(key) {
    const params = {
        Bucket: process.env.S3_BUCKET,
        Key: key,
    };
    await s3.send(new DeleteObjectCommand(params));
    removeFromLocalBucket(key);
}

module.exports = {
    uploadToS3: upload,
    getImages: downloadFromId,
    uploadAnyImage: uploadAnyImage,
    client: s3,
    fileExistsInS3,
    getBucketContents,
    getLocalBucketContents,
    addToLocalBucket,
    removeFromLocalBucket,
    addFileToBucket,
    deleteFromBucket,
};