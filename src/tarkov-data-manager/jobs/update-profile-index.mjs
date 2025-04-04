import zlib from 'node:zlib';

import DataJob from '../modules/data-job.mjs';
import { uploadFile } from '../modules/upload-s3.mjs';
import cloudflare from '../modules/cloudflare.mjs';
import gameModes from '../modules/game-modes.mjs';

class UpdateProfileIndexJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-profile-index'});
    }

    async run() {
        this.logger.log('Downloading all profiles...');
        const profiles = {};
        const updated = {};
        for (const gameMode of gameModes) {
            profiles[gameMode.name] = {};
            updated[gameMode.name] = {};
        }
        const batchSize = 1000000;
        let offset = 0;
        while (true) {
            const queryResult = await this.d1Query(
                'SELECT id, name, updated, updated_pve FROM eft_accounts LIMIT ?, ?',
                [offset, batchSize],
                {
                    maxRetries: 10,
                    signal: this.abortController.signal,
                    logger: this.logger,
                },
            );
            queryResult.results.forEach(r => {
                for (const gameMode of gameModes) {
                    let updatedField = 'updated';
                    if (gameMode.name !== 'regular') {
                        updatedField += `_${gameMode.name}`;
                    }
                    if (r[updatedField]) {
                        profiles[gameMode.name][r.id] = r.name;
                        updated[gameMode.name][r.id] = r[updatedField];
                    }
                }
            });
            this.logger.log(`Retrieved ${offset + queryResult.results.length} profile records`);
            if (queryResult.results.length !== batchSize) {
                break;
            }
            offset += batchSize;
        }
        
        for (const gameMode of gameModes) {
            this.logger.log(`Updating ${gameMode.name} profile indices of ${Object.keys(profiles[gameMode.name]).length} profiles...`);
            let indexPath = 'profile/';
            if (gameMode.name !== 'regular') {
                indexPath = gameMode.name + '/';
            }
            let gzipBuffer = zlib.gzipSync(JSON.stringify(profiles[gameMode.name]));
            this.logger.log('Completed gzip of profile data');
            let url = await uploadFile(gzipBuffer, indexPath + 'index.json', {
                bucket: 'players.tarkov.dev',
                contentType: 'application/json',
                contentEncoding: 'gzip'
            });
            this.logger.log('Uploaded index.json to S3');
            await cloudflare.purgeCache(url);
            this.logger.log(`Purged cache for ${url}`);
            gzipBuffer = zlib.gzipSync(JSON.stringify(updated[gameMode.name]));
            this.logger.log('Completed gzip of profile updated data');
            url = await uploadFile(gzipBuffer, indexPath + 'updated.json', {
                bucket: 'players.tarkov.dev',
                contentType: 'application/json',
                contentEncoding: 'gzip'
            });
            this.logger.log('Uploaded updated.json to S3');
            await cloudflare.purgeCache(url);
            this.logger.log(`Purged cache for ${url}`);
        }
        this.logger.success('Updated profile indices');
    }
}

export default UpdateProfileIndexJob;
