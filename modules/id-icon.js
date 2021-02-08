const Jimp = require('jimp');
const got = require('got');

const BORDER_THICKNESS = 1;

module.exports = async (itemId) => {
    const sourceUrl = `https://raw.githack.com/RatScanner/EfTIcons/master/uid/${itemId}.png`;

    try {
        await got(sourceUrl);
    } catch (loadError){
        // console.error(loadError);
        console.log(`${sourceUrl} doesn't exist`);

        return false;
    }

    const image = await Jimp.read(sourceUrl);

    return await image
        .background(0x383838FF)
        // Top
        .scan(0, 0, image.bitmap.width, BORDER_THICKNESS, function(x, y, idx) {
            // x, y is the position of this pixel on the image
            // idx is the position start position of this rgba tuple in the bitmap Buffer
            // this is the image

            var red = this.bitmap.data[idx + 0];
            var green = this.bitmap.data[idx + 1];
            var blue = this.bitmap.data[idx + 2];
            var alpha = this.bitmap.data[idx + 3];

            this.bitmap.data[idx] = 83;
            this.bitmap.data[idx + 1] = 89;
            this.bitmap.data[idx + 2] = 88;
            this.bitmap.data[idx + 3] = 255;

            // rgba values run from 0 - 255
            // e.g. this.bitmap.data[idx] = 0; // removes red from this pixel
        })
        // Bottom
        .scan(0, image.bitmap.height - BORDER_THICKNESS, image.bitmap.width, BORDER_THICKNESS, function(x, y, idx) {
            this.bitmap.data[idx] = 83;
            this.bitmap.data[idx + 1] = 89;
            this.bitmap.data[idx + 2] = 88;
            this.bitmap.data[idx + 3] = 255;
        })
        // Left
        .scan(0, 0, BORDER_THICKNESS, image.bitmap.height, function(x, y, idx) {
            this.bitmap.data[idx] = 83;
            this.bitmap.data[idx + 1] = 89;
            this.bitmap.data[idx + 2] = 88;
            this.bitmap.data[idx + 3] = 255;
        })
        // Right
        .scan(image.bitmap.width - BORDER_THICKNESS, 0, BORDER_THICKNESS, image.bitmap.height, function(x, y, idx) {
            this.bitmap.data[idx] = 83;
            this.bitmap.data[idx + 1] = 89;
            this.bitmap.data[idx + 2] = 88;
            this.bitmap.data[idx + 3] = 255;
        });
};