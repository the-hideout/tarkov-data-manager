const Jimp = require('jimp');

    // Color correction from BRGA to RGBA
    // let red, green, blue;
    // img.image.forEach((byte, i) => {
    //     switch (i % 4) {
    //     case 0: return blue = byte
    //     case 1: return green = byte
    //     case 2: return red = byte
    //     case 3:
    //         outImg.bitmap.data[i - 3] = red
    //         outImg.bitmap.data[i - 2] = green
    //         outImg.bitmap.data[i - 1] = blue
    //         outImg.bitmap.data[i] = 255
    //     }
    // });

module.exports = async (itemId) => {
    inputImage = `https://hideout-api.s3.us-east-1.amazonaws.com/${itemId}/latest.jpg`;

    const image = await Jimp.read(inputImage);

    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
        const red = this.bitmap.data[idx + 0];
        const blue = this.bitmap.data[idx + 2];

        this.bitmap.data[idx + 0] = blue;
        this.bitmap.data[idx + 2] = red;
    });

    await image
        .crop(879, 147, 64, 64);

    return image;
};