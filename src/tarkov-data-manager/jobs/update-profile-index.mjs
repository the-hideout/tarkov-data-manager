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
        for (const gameMode of gameModes) {
            profiles[gameMode.name] = {};
        }
        const batchSize = 1000000;
        let offset = 0;
        while (true) {
            const queryResult = await this.d1Query('SELECT id, name, updated, updated_pve FROM eft_accounts LIMIT ?, ?', [offset, batchSize]);
            queryResult.results.forEach(r => {
                for (const gameMode of gameModes) {
                    let updatedField = 'updated';
                    if (gameMode.name !== 'regular') {
                        updatedField += `_${gameMode.name}`;
                    }
                    if (r[updatedField]) {
                        profiles[gameMode.name][r.id] = r.name;
                    }
                }
            });
            this.logger.log(`Retrieved ${offset + queryResult.results.length} profile records`);
            if (queryResult.results.length !== batchSize) {
                break;
            }
            offset += batchSize;
        }
        
        const indexFilename = 'index.json';
        for (const gameMode of gameModes) {
            this.logger.log(`Updating ${gameMode.name} profile index of ${Object.keys(profiles[gameMode.name]).length} profiles...`);
            let indexPath = 'profile/';
            if (gameMode.name !== 'regular') {
                indexPath = gameMode.name + '/';
            }
            const gzipBuffer = zlib.gzipSync(JSON.stringify(profiles[gameMode.name]));
            this.logger.log('Completed gzip of profile data');
            const url = await uploadFile(gzipBuffer, indexPath + indexFilename, {
                bucket: 'players.tarkov.dev',
                contentType: 'application/json',
                contentEncoding: 'gzip'
            });
            this.logger.log('Uploaded index.json to S3');
            await cloudflare.purgeCache(url);
            this.logger.log(`Purged cache for ${url}`);
        }
        this.logger.success('Updated profile indices');
    }

    async cloudflareQuery(query, params) {
        if (!process.env.CLOUDFLARE_TOKEN) {
            return Promise.reject(new Error('CLOUDFLARE_TOKEN not set, skipping purge'));
        }
        const response = await fetch(`${BASE_URL}accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`, {
            method: 'POST',
            headers: {
                'authorization': `Bearer ${process.env.CLOUDFLARE_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                params: params ?? [],
                sql: query,
            }),
        });
        if (!response.ok) {
            return Promise.reject(new Error(`${response.status} ${response.statusText}`));
        }
        const result = await response.json();
        if (!result.success && result.errors) {
            return Promise.reject(new Error(`${result.errors[0].message} (${result.errors[0].code})`));
        }
        return result.result[0];
    }
}

export default UpdateProfileIndexJob;
