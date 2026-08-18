import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import sleep from './sleep.js';
import dbConnection from './db-connection.mjs';

const getEtag = async (url) => {
    const hash = crypto.hash('sha256', url);
    const results = await dbConnection.query('SELECT * FROM resource_etag WHERE path_hash = ?', [hash]);
    if (!results.length) {
        return;
    }
    return results[0].etag;
};

const setEtag = async (url, etag) => {
    const hash = crypto.hash('sha256', url);
    const result = await dbConnection.query(`
        INSERT INTO resource_etag (path_hash, etag)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
            etag = ?
    `, [hash, etag, etag]);
    //console.log('setEtag', result);
};

const clearEtag = async (url) => {
    const hash = crypto.hash('sha256', url);
    const result = await dbConnection.query('DELETE FROM resource_etag WHERE path_hash = ?', [hash]);
    //console.log('clearEtag', result);
};

class ApiClient {
    constructor(options = {}) {
        this.cacheFolder = options.cacheFolder;
        this.urlBase = options.urlBase;
        this.urlPattern = options.urlPattern ?? '{urlBase}{pathname}';
        this.headers = options.headers;

        if (typeof options.buildUrl === 'function') {
            this.buildUrlCustom = options.buildUrl;
        }
    }

    cachePath(filename) {
        const pathParts = [
            import.meta.dirname,
            '..',
            'cache',
        ];
        if (this.cacheFolder) {
            pathParts.push(this.cacheFolder);
        }
        if (filename) {
            pathParts.push(filename);
        }
        return path.join(...pathParts);
    }

    ensureCachePath() {
        const path = this.cachePath();
        if (fs.existsSync(path)) {
            return;
        }
        fs.mkdirSync(path, { recursive: true });
    }

    writeToCache(filename, content) {
        this.ensureCachePath();
        fs.writeFileSync(this.cachePath(filename), content);
    }

    buildUrl(options = {}) {
        if (this.buildUrlCustom) {
            return this.buildUrlCustom(options);
        }
        const urlString = this.urlPattern
            .replace('{urlBase}', this.urlBase)
            .replace('{pathname}', options.pathname ?? '');
        const url = new URL(urlString);
        options.searchParams ??= {};
        for (const pName in options.searchParams) {
            url.searchParams.set(pName, options.searchParams[pName]);
        }
        return url;
    }

    getCachedName(options) {
        const url = this.buildUrl(options);
        const pathname = url.toString().split('/').pop();
        return pathname
            .replace(/[\x00-\x1F\x7F]/g, '')  // Remove control characters
            .replace(/[<>:"/\\|?*]/g, '_')    // Replace illegal characters with underscores
            .replace(/[\s.]+$/, '');          // Strip trailing spaces and periods
    }

    getCached(options) {
        //console.log('getCached');
        return JSON.parse(fs.readFileSync(this.cachePath(options.cachedName)));
    }

    async get(options = {}) {
        options.cachedName ??= this.getCachedName(options);
        //console.log(options.cachedName);
        if (!options.refresh) {
            try {
                return this.getCached(options);
            } catch (error) {
                if (error.code !== 'ENOENT' && 
                    !error.message.includes('Unexpected end of JSON input')
                ) {
                    return Promise.reject(error);
                }
                options.notCached = true;
            }
        }
        const newJson = await this.request(options);
        this.writeToCache(options.cachedName, JSON.stringify(newJson, null, 4));
        return newJson;
    }

    async request(options = {}) {
        options.attempt ??= 0;
        options.retryLimit ??= 10;
        const timeout = options.timeout ?? 60000;
        const requestURL = this.buildUrl(options);
        const etag = await getEtag(requestURL.toString());
        //console.log(requestURL.toString(), etag);
        options.headers ??= {};
        if (etag) {
            options.headers['If-None-Match'] = etag;
        }
        Object.assign(options.headers, this.headers);
        try {
            const response = await fetch(requestURL, {
                method: options.method ?? 'GET',
                headers: options.headers,
                timeout: {
                    request: 60000,
                },
                signal: AbortSignal.any([
                    options.signal,
                    AbortSignal.timeout(timeout),
                ].filter(Boolean)),
            });
            if (response.status === 304) {
                try {
                    return this.getCached(options);
                } catch (cachedError) {
                    await clearEtag(url.toString());
                    return this.request(options);
                }
            }
            if (!response.ok) {
                if (response.status === 404) {
                    options.retryLimit = 0;
                }
                return Promise.reject(new Error(`${response.status} ${response.statusText}`));
            }
            const responseEtag = response.headers.get('etag');
            if (responseEtag) {
                //console.log('responseEtag', responseEtag);
                setEtag(requestURL.toString(), responseEtag);
            }
            if (response.headers.get('content-type')?.includes('application/json')) {
                return await response.json();
            }
            return response;
        } catch (error) {
            if (options.attempt >= options.retryLimit) {
                return Promise.reject(error);
            }
            options.attempt++;
            await sleep(1000, options.signal);
            return this.request(options);
        }
    }
}

export default ApiClient;
