import sharp from 'sharp';
import got from 'got';

import imgGen from 'tarkov-dev-image-generator';

import remoteData from './remote-data.mjs';
import { uploadToS3 } from './upload-s3.mjs';

const { imageFunctions } = imgGen;

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

export async function createFromSource(sourceImage, id, overwrite = true) {
    const items = await remoteData.get();
    const itemData = items.get(id);
    if (!itemData) {
        return Promise.reject(`Item ${id} not found in item data`);
    }
    const item = itemFromDb(itemData);
    if (typeof sourceImage === 'string') {
        sourceImage = sharp(sourceImage);
    }
    if (!await imageFunctions.canCreate8xImage(sourceImage, item)) {
        const metadata = await sourceImage.metadata();
        const neededSize = imageFunctions.get8xSize(item);
        return Promise.reject(new Error(`Item ${id} needs image sized ${neededSize.width}x${neededSize.height}, provided ${metadata.width}x${metadata.height}`));
    }
    /*const imageResults = await Promise.allSettled([
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
    ]);*/
    const images = [];
    for (const imageSizeKey in imageFunctions.imageSizes) {
        const imageSize = imageFunctions.imageSizes[imageSizeKey];
        const exists = !!itemData[imageSize.field];
        if (exists && !overwrite) {
            //images.push(Promise.reject(new Error(`${itemData.name} ${id} already has a ${imageSizeKey}`)));
            continue;
        }
        images.push(imageFunctions.createImage(imageSizeKey, sourceImage, item)
            .then(result => {return {image: result, type: imageSizeKey}}),
        );
    }
    const imageResults = await Promise.allSettled(images);
    const createdImages = [];
    const errors = [];
    for (const result of imageResults) {
        if (result.status === 'rejected') {
            errors.push(result.reason);
        } else {
            createdImages.push(result.value);
        }
    }
    if (errors.length > 0) {
        return Promise.reject(errors);
    }
    return createdImages.filter(Boolean);
}

export async function createAndUploadFromSource(sourceImage, id, overwrite = true) {
    const createdImages = await createFromSource(sourceImage, id, overwrite);
    const uploads = [];
    for (const result of createdImages) { 
        uploads.push(uploadToS3(result.image, result.type, id).then(purged => {
            return {
                type: result.type,
                purged: purged,
            }
        }));
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
    return uploadResults.map(result => result.value);
}

export async function regenerateFromExisting(id, backgroundOnly = false) {
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
    const imageData = await got(sourceUrl).buffer();
    const sourceImage = sharp(imageData);
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

const imageCreate = {
    createFromSource,
    createAndUploadFromSource,
    regenerateFromExisting
};

export default imageCreate;
