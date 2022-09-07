const fs = require('fs');
const path = require('path');
const Jimp = require('jimp-compact');
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const {fromEnv} = require('@aws-sdk/credential-provider-env');

const remoteData = require('./remote-data');

const s3 = new S3Client({
    region: 'us-east-1',
    credentials: fromEnv(),
});

// the filename:db field map of image types
const imageTypes = {
    image: {
        field: 'image_link',
        format: 'jpg'
    },
    'grid-image': {
        field: 'grid_image_link',
        format: 'jpg'
    },
    icon: {
        field: 'icon_link',
        format: 'jpg'
    },
    large: {
        field: 'large_image_link',
        format: 'png'
    },
    'base-image': {
        format: 'png'
    }
};

const imageFormats = {
    jpg: {
        contentType: 'image/jpeg',
        MIME: Jimp.MIME_JPEG
    },
    png: {
        contentType: 'image/png',
        MIME: Jimp.MIME_PNG
    }
};

async function upload(imagePath, imageType, id) {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        return Promise.reject(new Error('aws variables not configured; image upload disabled'));
    }
    const typeInfo = imageTypes[imageType];
    if (!typeInfo) return Promise.reject(new Error(`${imageType} is not a valid image type`));
    const image = await Jimp.read(imagePath);
    if(!image){
        return Promise.reject(new Error('Failed to load image'));
    }
    const imageFormat = imageFormats[typeInfo.format];
    const uploadParams = {
        Bucket: process.env.S3_BUCKET,
        Key: `${id}-${imageType}.${typeInfo.format}`,
        ContentType: imageFormat.contentType,
        Body: await image.getBufferAsync(imageFormat.MIME)
    };
    await s3.send(new PutObjectCommand(uploadParams));
    console.log(`${id} ${imageType} saved to s3`);
    if (typeInfo.field) {
        const imageLink = `https://${process.env.S3_BUCKET}/${id}-${imageType}.${typeInfo.format}`;
        const imageField = typeInfo.field;
        await remoteData.setProperty(id, imageField, imageLink);
    }
}

async function downloadFromId(item) {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        return Promise.reject(new Error('aws variables not configured; image download disabled'));
    }
    if (typeof item === 'string') {
        allItems = await remoteData.get();
        item = allItems.get(item);
    }
    existingBaseImages = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'existing-bases.json')));
    const imageRequests = [];
    const errors = [];
    for (const imageType in imageTypes) {
        const typeInfo = imageTypes[imageType];
        const input = {
            Bucket: process.env.S3_BUCKET,
        };
        const filename = `${item.id}-${imageType}.${typeInfo.format}`;
        if (!typeInfo.field && existingBaseImages.includes(item.id)) {
            input.Key = filename;
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
    }
    const imageResponses = (await Promise.all(imageRequests)).filter(Boolean);
    return {images: imageResponses, errors: errors};
}

module.exports = {
    uploadToS3: upload,
    imageTypes: imageTypes,
    imageFormats: imageFormats,
    getImages: downloadFromId
};