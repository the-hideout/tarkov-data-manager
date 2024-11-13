import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { fromEnv } from '@aws-sdk/credential-providers';
import imgGen from 'tarkov-dev-image-generator';

import cloudflare from './cloudflare.mjs';
import remoteData from './remote-data.mjs';

const { imageSizes } = imgGen.imageFunctions;

const s3 = new S3Client({
    region: 'us-east-1',
    credentials: fromEnv(),
});

sharp.cache( { files: 0 } );

export async function uploadFile(fileBuffer, filename, options) {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        return Promise.reject(new Error('aws variables not configured; file upload disabled'));
    }
    if (typeof options !== 'object') {
        options = {};
    }
    if (!options.contentType) {
        return Promise.reject(new Error('Must specify content type'));
    }
    if (!options.contentEncoding) {
        return Promise.reject(new Error('Must specify content encoding'));
    }
    if (!options.bucket) {
        return Promise.reject(new Error('Must specify bucket'));
    }
    const uploadParams = {
        Bucket: options.bucket,
        Key: filename,
        ContentType: options.contentType,
        ContentEncoding: options.contentEncoding,
        Body: fileBuffer,
    };
    await s3.send(new PutObjectCommand(uploadParams));
    return `https://${options.bucket}/${filename}`;
}

export async function uploadAnyImage(image, filename, contentType) {
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
    if (fileExistsInS3(filename)) {
        await cloudflare.purgeCache(`https://${uploadParams.Bucket}/${uploadParams.Key}`);
        return true;
    }
    addToLocalBucket(filename);
    return false;
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
        addToLocalBucket(uploadParams.Key);
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
            console.log('%s not found', filename)
            return false;
        }
        return Promise.reject(error);
    }
}

export const getBucketContents = async (continuationToken = false) => {
    const input = {
        Bucket: process.env.S3_BUCKET,
    };

    if (continuationToken) {
        input.ContinuationToken = continuationToken;
    }

    let responseKeys = [];

    const command = new ListObjectsV2Command(input);
    const response = await s3.send(command);

    responseKeys = response.Contents.reduce((all, item) => {
        if (item.Key.startsWith('Applications/')) {
            return all;
        }
        if (item.Key.startsWith('maps/') && !item.Key.startsWith('maps/svg/')) {
            return all;
        }
        if (item.Key.startsWith('profile/')) {
            return all;
        }
            
        all.push(item.Key);
        return all;
    }, []);

    if (response.NextContinuationToken) {
        //console.log(`Retrieved ${responseKeys.length} files in bucket, continuing`);
        responseKeys = responseKeys.concat(await getBucketContents(response.NextContinuationToken));
    }
    if (!continuationToken) {
        fs.writeFileSync(path.join(import.meta.dirname, '..', 'cache', 's3-bucket-contents.json'), JSON.stringify(responseKeys, null, 4));
    }
    //console.log(`Retrieved ${responseKeys.length} files in bucket`);

    return responseKeys;
}

export const getLocalBucketContents = () => {
    try {
        return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'cache', 's3-bucket-contents.json')));
    } catch (error) {
        return [];
    }
};

export const addToLocalBucket = filename => {
    const contents = getLocalBucketContents();
    if (!contents.includes(filename)) {
        contents.push(filename);
        fs.writeFileSync(path.join(import.meta.dirname, '..', 'cache', 's3-bucket-contents.json'), JSON.stringify(contents, null, 4));
    }
};

const removeFromLocalBucket = filename => {
    let contents = getLocalBucketContents();
    if (contents.includes(filename)) {
        contents = contents.filter(fn => fn !== filename);
        fs.writeFileSync(path.join(import.meta.dirname, '..', 'cache', 's3-bucket-contents.json'), JSON.stringify(contents, null, 4));
    }
};

export async function addFileToBucket(localFilePath, fileName) {
    let contentType;
    const contentTypes = {
        gif: 'image/gif',
        jpg: 'image/jpeg',
        json: 'application/json',
        png: 'image/png',
        svg: 'image/svg+xml',
        webp: 'image/webp',
    };
    for (const extension in contentTypes) {
        if (fileName.endsWith(extension)) {
            contentType = contentTypes[extension];
            break;
        }
    }
    const uploadParams = {
        Bucket: process.env.S3_BUCKET,
        Key: fileName,
        ContentType: contentType,
        Body: fs.readFileSync(localFilePath)
    };
    const fileExists = await fileExistsInS3(fileName);
    await s3.send(new PutObjectCommand(uploadParams));
    if (fileExists) {
        await cloudflare.purgeCache(`https://${uploadParams.Bucket}/${uploadParams.Key}`);
    }
    addToLocalBucket(fileName);
}

export async function deleteFromBucket(key) {
    const params = {
        Bucket: process.env.S3_BUCKET,
        Key: key,
    };
    await s3.send(new DeleteObjectCommand(params));
    await cloudflare.purgeCache(`https://${params.Bucket}/${params.Key}`);
    removeFromLocalBucket(key);
}

export async function copyFile(oldName, newName) {
    if (oldName === newName) {
        return Promise.reject(new Error(`Cannot copy ${oldName} to the same name`));
    }
    const params = {
        Bucket: process.env.S3_BUCKET,
        CopySource: `${process.env.S3_BUCKET}/${oldName}`,
        Key: newName,
    };
    const fileExists = await fileExistsInS3(newName);
    await s3.send((new CopyObjectCommand(params)));
    if (fileExists) {
        await cloudflare.purgeCache(`https://${params.Bucket}/${params.Key}`);
    }
    addToLocalBucket(newName);
}

export async function renameFile(oldName, newName) {
    await copyFile(oldName, newName);
    await deleteFromBucket(oldName);
}

const uploadS3 = {
    uploadToS3: upload,
    getImages: downloadFromId,
    uploadAnyImage,
    client: s3,
    fileExistsInS3,
    getBucketContents,
    getLocalBucketContents,
    addToLocalBucket,
    removeFromLocalBucket,
    addFileToBucket,
    deleteFromBucket,
    copyFile,
    renameFile,
};

export const { uploadToS3, getImages } = uploadS3;

export default uploadS3;
