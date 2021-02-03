const https = require('https');

const sizeOf = require('image-size');

module.exports = (imageUrl) => {
    return new Promise((resolve, reject) => {
        if(!imageUrl){
            return resolve(false);
        }
        https.get(imageUrl, (response) => {
            var chunks = [];

            response
                .on('data', (chunk) => {
                    chunks.push(chunk);
                })
                .on('end', () => {
                    var buffer = Buffer.concat(chunks);
                    const size = sizeOf(buffer);

                    if(size.width > size.height){
                        return resolve(true);
                    }

                    return resolve(false);
                });
        });
    })
};
