import fs from 'node:fs';
import path from 'node:path';

import filenamify from 'filenamify';

import dataOptions from './data-options.mjs';
import gameModes, { getGameMode } from './game-modes.mjs';
import sleep from './sleep.js';
import ApiClient from './api-client.mjs';

const defaultOptions = dataOptions.default;
const merge = dataOptions.merge;

const mdClient = new ApiClient({
    cacheFolder: 'mdata',
    urlBase: `${process.env.MD_URL}/data/raw/`,
    headers: {
        'Accept': 'application/json',
        'X-API-KEY': process.env.MD_KEY,
    },
});

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

const mData = {
    get: async (path, options) => {
        return mdClient.get({
            pathname: path,
            refresh: options.download,
            ...options
        });
    },
    locales: async (options = defaultOptions) => {
        const locales = {};
        const localeRequests = [];
        for (const request in requests) {
            if (!request.startsWith('locale_')) {
                continue;
            }
            localeRequests.push(mData.get(requests[request], structuredClone(options)).then(data => {
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
        return mData.get(path, options);
    },
}

export default mData;
