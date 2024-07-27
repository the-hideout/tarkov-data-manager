import fs from 'node:fs';
import path from 'node:path';

import formidable from 'formidable';

import scannerApi from './scanner-api.mjs';

const getJson = (options) => {
    const response = {errors: [], warnings: [], data: {}};
    try {
        let file = options.file;
        file = file.split('/').pop();
        file = file.split('\\').pop();
        if (!file.endsWith('.json')) throw new Error(`${file} is not a valid json file`);
        if (fs.existsSync(path.join(import.meta.dirname, '..', 'cache', file))) {
            response.data = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'cache', file)));
        } else {
            response.data = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'dumps', file)));
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            response.errors.push(`Error: ${options.file} not found`);
        } else {
            response.errors.push(String(error));
        }
    }
    return response;
};

const submitImage = async (request, user) => {
    const response = {errors: [], warnings: [], data: []};
    const form = formidable({
        uploadDir: path.join(import.meta.dirname, '..', 'cache'),
    });

    console.log(`User ${user.username} submitting image`);

    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        response.errors.push('aws variables not configured; image upload disabled');
        return response;
    }

    let fields;
    let files;

    try {
        [fields, files] = await form.parse(request);
        const imagePaths = {};
        for (const itemId of fields.id[0].split(',')) {
            imagePaths[itemId] = files[itemId][0].filepath;
        }
        const apiResponse = await scannerApi.submitSourceImages({
            images: imagePaths,
            overwrite: fields.overwrite[0],
        });
        response.data = apiResponse.data;
        response.warnings = apiResponse.warnings;
        response.errors = apiResponse.errors;
    } catch (error) {
        console.error(error);
        response.errors.push(String(error));
    }

    if (files) {
        for (const key in files) {
            for (const file of files[key]) {
                fs.rm(file.filepath, error => {
                    if (error) {
                        console.log(`Error deleting ${file.filepath}`, error);
                    }
                });
            }
        }
    }
    return response;
};

const scannerHttpApi = {
    request: async (req, res, resource) => {
        const username = req.headers.username;
        const password = req.headers.password;
        const user = (await scannerApi.getUsers())[username];
        if ((!username || !password) || !user || !user.password || (user.password !== password)) {
            return res.json({errors: ['access denied'], warnings: [], data: {}});
        }
        if (resource === 'image') {
            return res.json(await submitImage(req, user));
        }
        if (resource === 'json') {
            if (user.flags & scannerApi.userFlags.jsonDownload) {
                return res.json(getJson({...req.body, scannerName: req.headers.scanner}));
            } else {
                return res.json({errors: ['You are not authorized to perform that action'], warnings: [], data: {}});
            }
        }
        if (resource === 'submit-data') {
            if (user.flags & scannerApi.userFlags.submitData) {
                return res.json(scannerApi.submitJson(req.body));
            } else {
                return res.json({errors: ['You are not authorized to perform that action'], warnings: [], data: {}});
            }
        }
        try {
            let response = false;
            let options = req.body;
            if (typeof options !== 'object') {
                options = {};
            }
            options.user = user;
            options.scannerName = req.headers.scanner;
            if (!options.scannerName) {
                return res.json({errors: ['no scanner name specified'], warnings: [], data: {}});
            }
            if (resource === 'items') {
                options.scanner = await scannerApi.getScanner(options, true);
                if (req.method === 'GET') {
                    response = await scannerApi.getItems(options);
                }
                if (req.method === 'POST') {
                    response = await scannerApi.insertPrices(options);
                }
                if (req.method === 'DELETE') {
                    response = await scannerApi.releaseItem(options);
                }
            }
            if (resource === 'scanner') {
                if (req.method === 'DELETE') {
                    response = await scannerApi.deleteScanner(options);
                }
                if (req.method === 'POST') {
                    response = await scannerApi.renameScanner(options);
                }
            }
            /*if (resource === 'traders') {
                if (req.method === 'POST') {
                    response = await insertTraderRestock(options);
                }
            }*/
            if (resource === 'trader-scan-active') {
                response = {
                    errors: [],
                    warnings: [],
                    data: !!await scannerApi.currentTraderScan(),
                };
            }
            if (resource === 'offers') {
                if (req.method === 'POST') {
                    options.scanner = await scannerApi.getScanner(options, true);
                    response = await scannerApi.addTraderOffers(options);
                }
            }
            if (resource === 'ping' && req.method === 'GET') {
                response = {errors: [], warnings: [], data: 'ok'};
            }
            if (response) {
                res.json(response);
                return;
            }
        } catch (error) {
            console.log('Scanner API Error', error);
            return res.json({errors: [String(error)], warnings: [], data: {}});
        }
        res.json({errors: ['unrecognized request'], warnings: [], data: {}});
    },
};

export default scannerHttpApi;
