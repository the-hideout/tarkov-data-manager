const sharp = require('sharp');

const axios = require('axios');
const { imageFunctions } = require('tarkov-dev-image-generator');

const remoteData = require('../modules/remote-data');
const { uploadToS3 } = require('./upload-s3');

function itemFromDb(itemData) {
    return {
        id: itemData.id,
        name: itemData.name,
        shortName: itemData.short_name,
        backgroundColor: itemData.properties.backgroundColor,
        width: itemData.width,
        height: itemData.height,
        types: itemData.types,
        image8xLink: itemData.image_8x_link,
        baseImageLink: itemData.base_image_link,
    };
}

async function createFromSource(sourceImage, id) {
    const items = await remoteData.get();
    const itemData = items.get(id);
    if (!itemData) {
        return Promise.reject(`Item ${id} not found in item data`);
    }
    const item = itemFromDb(itemData);
    if (typeof sourceImage === 'string') {
        sourceImage = sharp(sourceImage);
    }
    const imageResults = await Promise.allSettled([
        imageFunctions.createIcon(sourceImage, item)
            .then(result => {return {image: result, type: 'icon'}}),
        imageFunctions.createBaseImage(sourceImage, item)
            .then(result => {return {image: result, type: 'base-image'}}),
        imageFunctions.createGridImage(sourceImage, item)
            .then(result => {return {image: result, type: 'grid-image'}}),
        imageFunctions.createInspectImage(sourceImage, item)
            .then(result => {return {image: result, type: 'image'}}).catch(() => false),
        imageFunctions.create512Image(sourceImage, item)
            .then(result => {return {image: result, type: '512'}}).catch(() => false),
        imageFunctions.create8xImage(sourceImage, item)
            .then(result => {return {image: result, type: '8x'}}).catch(() => false),
    ]);
    const createdImages = [];
    const errors = [];
    for (const result of imageResults) {
        if (result.status === 'rejected') {
            errors.push(result.reason);
        } else {
            createdImages.push(result.value);
        }
    }
    /*if (errors.length > 0) {
        return Promise.reject(errors);
    }*/
    return createdImages.filter(Boolean);
}

async function createAndUploadFromSource(sourceImage, id) {
    const createdImages = await createFromSource(sourceImage, id);
    const uploads = [];
    for (const result of createdImages) { 
        uploads.push(uploadToS3(result.image, result.type, id));
    }
    const uploadResults = await Promise.allSettled(uploads);
    const errors = [];
    for (const uploadResult of uploadResults) {
        if (uploadResult.status === 'rejected') {
            errors.push(uploadResult.reason);
        }
    }
    if (errors.length > 0) {
        return Promise.reject(errors);
    }
    return createdImages.map(img => img.type);
}

async function regenerateFromExisting(id, backgroundOnly = false) {
    const items = await remoteData.get();
    const itemData = items.get(id);
    if (!itemData) {
        return Promise.reject(`Item ${id} not found in item data`);
    }
    const item = itemFromDb(itemData);
    let regenSource = '8x';
    let sourceUrl = item.image8xLink;
    if (item.image8xLink.includes('unknown-item')) {
        if (item.baseImageLink.includes('unknown-item')) {
            return Promise.reject(new Error(`${item.name} does not have an 8x or base image to regnerate images from`));
        }
        sourceUrl = `https://${process.env.S3_BUCKET}/${id}-base-image.png`;
        regenSource = 'base';
    }
    const imageData = (await axios({ url: sourceUrl, responseType: 'arraybuffer' })).data;
    const sourceImage = sharp(await sharp(imageData).png().toBuffer());
    const imageJobs = [
        imageFunctions.createIcon(sourceImage, item)
            .then(result => {return {image: result, type: 'icon'}})
            .catch(error => {return Promise.reject({type: 'icon', error: error})}),
        imageFunctions.createGridImage(sourceImage, item)
            .then(result => {return {image: result, type: 'grid-image'}})
            .catch(error => {return Promise.reject({type: 'grid', error: error})}),
    ];
    if (!backgroundOnly) {
        if (regenSource === '8x') {
            imageJobs.push(
                imageFunctions.createInspectImage(sourceImage, item)
                    .then(result => {return {image: result, type: 'image'}})
                    .catch(error => {return Promise.reject({type: 'inspect', error: error})})
            );
            imageJobs.push(
                imageFunctions.createBaseImage(sourceImage, item)
                    .then(result => {return {image: result, type: 'base-image'}})
                    .catch(error => {return Promise.reject({type: 'base', error: error})})
            );
            imageJobs.push(
                imageFunctions.create512Image(sourceImage, item)
                    .then(result => {return {image: result, type: '512'}})
                    .catch(error => {return Promise.reject({type: '512', error: error})})
            );
        } else {
            if (await imageFunctions.canCreateInspectImage(sourceImage)) {
                imageJobs.push(
                    imageFunctions.createInspectImage(sourceImage, item)
                        .then(result => {return {image: result, type: 'image'}})
                        .catch(error => {return Promise.reject({type: 'inspect', error: error})})
                );
            }
        }
    }
    const imageResults = await Promise.allSettled(imageJobs);
    const createdImages = [];
    const errors = [];
    for (const result of imageResults) {
        if (result.status === 'rejected') {
            const error = result.reason.error;
            error.message = `${result.reason.type} image error: ${error.message}`;
            errors.push(error);
        } else {
            createdImages.push(result.value);
        }
    }
    if (errors.length > 0) {
        return Promise.reject(errors);
    }
    errors.length = 0;
    const uploads = [];
    for (const result of createdImages) { 
        uploads.push(uploadToS3(result.image, result.type, id));
    }
    const uploadResults = await Promise.allSettled(uploads);
    for (const uploadResult of uploadResults) {
        if (uploadResult.status === 'rejected') {
            errors.push(uploadResult.reason);
        }
    }
    if (errors.length > 0) {
        return Promise.reject(errors);
    }
    return {images: createdImages.map(img => img.type), source: regenSource};
}

module.exports = {
    createFromSource,
    createAndUploadFromSource,
    regenerateFromExisting
};