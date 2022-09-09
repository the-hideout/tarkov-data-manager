const fs = require('fs');
const sharp = require('sharp');

const { imageFunctions } = require('tarkov-dev-image-generator');

const { uploadToS3 } = require('./upload-s3');
const jobOutput = require('./job-output');

async function deleteCreatedImages(imageResults) {
    if (imageResults) {
        for (const imageResult of imageResults) {
            //console.log('removing', imageResult.path);
            fs.rm(imageResult.path, error => {
                if (error) console.log(`Error deleting ${imageResult.path}`, error);
            });
        }
    }
}

async function createFromSource(sourceImage, id) {
    const itemData = await jobOutput('update-item-cache', './dumps/item_data.json');
    const item = itemData[id];
    if (!item) {
        return Promise.reject(`Item ${id} not found in processed item data`);
    }
    if (item.types.includes('gun')) {
        item.width = item.properties.defaultWidth;
        item.height = item.properties.defaultHeight;
    }
    if (typeof sourceImage === 'string') {
        sourceImage = sharp(sourceImage);
    }
    const imageResults = await Promise.allSettled([
        imageFunctions.createIcon(sourceImage, item).then(result => {return {image: result, type: 'icon'}}),
        imageFunctions.createBaseImage(sourceImage, item).then(result => {return {image: result, type: 'base-image'}}),
        imageFunctions.createGridImage(sourceImage, item).then(result => {return {image: result, type: 'grid-image'}}),
        imageFunctions.createInspectImage(sourceImage, item).then(result => {return {image: result, type: 'image'}}).catch(() => false),
        imageFunctions.create512Image(sourceImage, item).then(result => {return {image: result, type: '512'}}).catch(() => false),
        imageFunctions.create8xImage(sourceImage, item).then(result => {return {image: result, type: '8x'}}).catch(() => false),
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
        deleteCreatedImages(createdImages.filter(Boolean));
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
        //deleteCreatedImages(createdImages);
        return Promise.reject(errors);
    }
    //deleteCreatedImages(createdImages);
    return createdImages.map(img => img.type);
}

module.exports = {
    createFromSource,
    createAndUploadFromSource,
};