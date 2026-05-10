import fs from 'node:fs';
import path from 'node:path';

import filenamify from 'filenamify';

import dataOptions from './data-options.mjs';
import gameModes, { getGameMode } from './game-modes.mjs';
import sleep from './sleep.js';

const defaultOptions = dataOptions.default;
const merge = dataOptions.merge;

const requests = {
    locale_cs: 'languages/cz.json',
    locale_de: 'languages/ge.json',
    //locale_en: 'languages/en.json',
    locale_es: 'languages/es.json',
    locale_fr: 'languages/fr.json',
    locale_hu: 'languages/hu.json',
    locale_id: 'languages/in.json',
    locale_it: 'languages/it.json',
    locale_ja: 'languages/jp.json',
    locale_ko: 'languages/kr.json',
    locale_pl: 'languages/pl.json',
    locale_pt: 'languages/po.json',
    locale_ro: 'languages/ro.json',
    locale_ru: 'languages/ru.json',
    locale_sk: 'languages/sk.json',
    locale_th: 'languages/th.json',
    locale_tr: 'languages/tu.json',
    locale_vn: 'languages/vi.json',
    locale_zh: 'languages/ch.json',
};

const jsonRequest = async (pathname, options) => {
    if (!process.env.MD_URL || !process.env.MD_KEY) {
        return Promise.reject(new Error('MD_URL or MD_KEY not set'));
    }
    options.attempt ??= 0;
    options.retryLimit ??= 10;
    const timeout = options.timeout ?? 20000;
    const url = new URL(process.env.MD_URL);
    url.pathname = pathname;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-API-KEY': process.env.MD_KEY,
            },
            signal: AbortSignal.any([
                options.signal,
                AbortSignal.timeout(timeout),
            ].filter(Boolean)),
        });
        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
        }
        const apiResponse = await response.json();
        if (!apiResponse) {
            throw new Error('MD returned null result');
        }
        return apiResponse;
    } catch (error) {
        if (options.attempt >= options.retryLimit) {
            return Promise.reject(error);
        }
        options.attempt++;
        await sleep(1000, options.signal);
        return jsonRequest(filename, options);
    }
};

const cachePath = (filename) => {
    const pathParts = [
        import.meta.dirname,
        '..',
        'cache',
        'mdata',
    ];
    if (filename) {
        pathParts.push(filename);
    }
    return path.join(...pathParts);   
}

const ensureCachePath = () => {
    const path = cachePath();
    if (fs.existsSync(path)) {
        return;
    }
    fs.mkdirSync(path, { recursive: true });
};

const writeToCache = (filename, content) => {
    ensureCachePath();
    fs.writeFileSync(cachePath(filename), content);
};

const mData = {
    get: async (path, options) => {
        const { download } = merge(options);
        const saveFileName = filenamify(path, {replacement: '_'});

        if (download) {
            const returnValue = await jsonRequest(path, options);
            writeToCache(saveFileName, JSON.stringify(returnValue, null, 4));
            return returnValue;
        }
        try {
            return JSON.parse(fs.readFileSync(cachePath(saveFileName)));
        } catch (error) {
            if (error.code === 'ENOENT') {
                return mData.get(path, {...options, download: true});
            }
            return Promise.reject(error);
        }
    },
    locales: async (options = defaultOptions) => {
        const locales = {};
        const localeRequests = [];
        for (const request in requests) {
            if (!request.startsWith('locale_')) {
                continue;
            }
            localeRequests.push(mData.get(`/data/raw/${requests[request]}`, options).then(data => {
                locales[request.replace('locale_', '')] = data;
            }));
        }
        await Promise.all(localeRequests);
        return locales;
    },
    locale: async (locale, options = defaultOptions) => {
        const path = requests[`locale${locale}`];
        if (!path) {
            return Promise.reject(new Error(`${locale} is not a valid locale value`));
        }
        return mData.get(`/data/raw/${path}`, options);
    },
}

export default mData;
