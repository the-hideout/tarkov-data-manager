import DataJob from '../modules/data-job.mjs';
import remoteData from '../modules/remote-data.mjs';
import { createAndUploadFromSource } from '../modules/image-create.mjs';

class UpdateItemImagesJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-item-images'});
    }

    async run() {
        [
            this.items,
        ] = await Promise.all([
            remoteData.get(),
        ]);

        let numberOfMissingImages = 0;

        const promises = [];
         for (const item of this.items.values()) {               
            if (item.image_8x_link) {
                continue;
            }
            numberOfMissingImages++;
            promises.push(this.getItemImage(item));
        }
        this.logger.log(`Creating ${numberOfMissingImages} item images`);
        await Promise.all(promises);
    }

    async getItemImage(item) {
        try {
            let image;
            if (item.types.includes('preset')) {
                image = await this.fenceFetchImage('/preset-image', {
                    method: 'POST',
                    body: JSON.stringify({
                        id: item.id,
                        items: item.properties.items,
                    }),
                });
            } else if (item.types.includes('replica')) {
                image = await this.fenceFetchImage(`/item-image/${item.properties.source}`);
            } else {
                image = await this.fenceFetchImage(`/item-image/${item.id}`);
            }
            await createAndUploadFromSource(image, item.id);
            this.logger.success(`${item.name} ${item.id} created`);
        } catch (error) {
            this.logger.error(`${item.name} ${item.id} error: ${error}`);
        }
    }
}

export default UpdateItemImagesJob;
