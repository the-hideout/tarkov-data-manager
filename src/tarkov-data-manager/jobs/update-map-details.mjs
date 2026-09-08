// This job only needs to be manually invoked
// when the data files have changed.

import DataJob from '../modules/data-job.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import gameModes from '../modules/game-modes.mjs';

class UpdateMapDetailsJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-map-details'});
    }

    async run() {
        // purge the cache to force new file download
        this.logger.time('cache-purge');
        await this.purgeCachePrefix('https://norvinsk.tarkov.dev/maps_data');
        this.logger.timeEnd('cache-purge');
        // download map details files
        this.logger.time('download');
        const mapDetails = await tarkovData.mapDetails({download: true});
        this.logger.timeEnd('download');
        return mapDetails;
    }
}

export default UpdateMapDetailsJob;
