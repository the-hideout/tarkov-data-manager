import DataJob from '../modules/data-job.mjs';
import remoteData from '../modules/remote-data.mjs';
import presetData from '../modules/preset-data.mjs';
import webSocketServer from '../modules/websocket-server.mjs';
import { createAndUploadFromSource } from '../modules/image-create.mjs';

class UpdateProfileIndexJob extends DataJob {
    constructor(options) {
        super({...options, name: 'refresh-item-images'});
    }

    async run() {
        const [
            items,
            gamePresets,
         ] = await Promise.all([
            remoteData.get(),
            presetData.getGamePresets(),
        ]);

        const errorCount = {};
        const startIndex = 4248;
        const skipIds = [
            '619bdeb986e01e16f839a99e',
        ];

        const itemIds = items.keys().toArray();
        this.logger.log(`Refreshing ${itemIds.length} item images starting at ${startIndex}`);
        for (let i = startIndex; i < itemIds.length; i++) {
            const id = itemIds[i];
            if (skipIds.includes(id)) {
                continue;
            }
            const item = items.get(id);
            if (item.types.includes('disabled')) {
                continue;
            }
            try {
                let newImages = {};
                if (!item.types.includes('preset')) {
                    newImages = await webSocketServer.getImages(item.id);
                } else if (gamePresets[id]) {
                    continue;
                } else {
                    newImages[id] = await webSocketServer.getJsonImage({
                        id,
                        items: item.properties.items ?? item.properties._items,
                    });
                }
                
                await Promise.all(Object.keys(newImages).map(imageId => createAndUploadFromSource(newImages[imageId], imageId)));
                for (const imageId in newImages) {
                    const imageItem = items.get(imageId);
                    this.logger.log(`Refreshed ${imageItem.short_name} ${imageId} images ${i}`);
                }
            } catch (error) {
                console.log(error);
                errorCount[id] = errorCount[id] ?? 0;
                errorCount[id]++;
                if (errorCount[id] < 5) {
                    i--;
                } else {
                    this.logger.error(`Unable to refresh ${item.short_name} ${id} images ${i}`);
                    this.logger.error(JSON.stringify(error, null, 4));
                }
            }
        }
        this.logger.success('Refreshed item images');
    }
}

export default UpdateProfileIndexJob;
