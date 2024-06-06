import fs from 'node:fs';
import path from 'node:path';

import formidable from 'formidable';
import imgGen from 'tarkov-dev-image-generator';

import remoteData from './remote-data.mjs';
import { uploadToS3 } from './upload-s3.mjs';
import { createAndUploadFromSource } from './image-create.mjs';
import scannerApi from './scanner-api.mjs';

const { imageSizes } = imgGen.imageFunctions;

let presets = {};
let presetsTimeout = false;

const updatePresets = () => {
    try {
        const fileContents = fs.readFileSync(path.join(import.meta.dirname, '..', 'cache', 'presets.json'));
        presets = JSON.parse(fileContents);
        presets.byBase = Object.values(presets.presets).reduce((all, p) => {
            if (!all[p.baseId]) {
                all[p.baseId] = [];
            }
            all[p.baseId].push(p);
            return all;
        }, {});
    } catch (error) {
        console.log('ScannerAPI error reading presets.json:', error.message);
    }
};

fs.watch(path.join(import.meta.dirname, '..', 'cache'), {persistent: false}, (eventType, filename) => {
    if (filename === 'presets.json') {
        clearTimeout(presetsTimeout);
        presetsTimeout = setTimeout(updatePresets, 100);
        
    }
});

updatePresets();

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

const submitImage = (request, user) => {
    const response = {errors: [], warnings: [], data: []};
    const form = formidable({
        multiples: true,
        uploadDir: path.join(import.meta.dirname, '..', 'cache'),
    });

    console.log(`User ${user.username} submitting image`);

    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        response.errors.push('aws variables not configured; image upload disabled');
        return response;
    }

    return new Promise(resolve => {
        const finish = (response, files) => {
            if (files) {
                for (const key in files.file) {
                    let file = files.file[key][0];
                    fs.rm(file.filepath, error => {
                        if (error) {
                            console.log(`Error deleting ${file.filepath}`, error);
                        }
                    });
                }
            }
            resolve(response);
        };
        form.parse(request, async (err, fields, files) => {
            if (err) {
                console.log(err);
                response.errors.push(String(err));
                return resolve(response);
            }

            fields = {
                id: fields.id[0],
                type: fields.type[0],
                presets: fields.presets ? fields.presets[0].split(',') : [],
                overwrite: fields.overwrite ? fields.overwrite[0] : false,
            };
    
            //console.log(fields);
            //console.log(JSON.stringify(files, null, 4));
    
            const allItemData = await remoteData.get();
            const currentItemData = allItemData.get(fields.id);
            const checkImageExists = imageType => {
                const field = imageSizes[imageType].field;
                return currentItemData[field];
            };

            if (fields.type === 'source') {
                /*if (fields.overwrite !== 'true') {
                    for (const imgType of Object.keys(imageSizes)) {
                        if (checkImageExists(imgType)) {
                            console.log(`Item ${fields.id} already has a ${imgType} image`);
                            response.errors.push(`Item ${fields.id} already has a ${imgType} image`);
                            return finish(response, files);
                        }
                    }
                }*/
                try {
                    response.data = await createAndUploadFromSource(files[fields.type][0].filepath, fields.id, fields.overwrite);
                    for (const presetId of fields.presets) {
                        let matchedPreset;
                        if (presetId === 'default') {
                            matchedPreset = presets.byBase[fields.id]?.find(preset => preset.default);
                        } else {
                            matchedPreset = presets.presets[presetId];
                        }
                        if (matchedPreset) {
                            const presetResult = await createAndUploadFromSource(files[presetId][0].filepath, matchedPreset.id, fields.overwrite);
                            response.data.push(...presetResult);
                        }
                    }
                } catch (error) {
                    console.error(error);
                    if (Array.isArray(error)) {
                        response.errors.push(...error.map(err => String(err)));
                    } else {
                        response.errors.push(String(error));
                    }
                    return finish(response, files);
                }
                return finish(response, files);
            }
    
            if(!Object.keys(imageSizes).includes(fields.type)) {
                console.log(`Invalid image type: ${fields.type}`);
                response.errors.push(`Invalid image type: ${fields.type}`);
                return finish(response, files);
            }
    
            let imageExists = checkImageExists(fields.type);

            if (imageExists && fields.overwrite !== 'true' && !(scannerApi.userFlags.overwriteImages & user.flags)) {
                console.log(`Item ${fields.id} already has a ${fields.type}`);
                response.errors.push(`Item ${fields.id} already has a ${fields.type}`);
                return finish(response, files);
            }
    
            try {
                response.data.push({
                    type: fields.type,
                    purged: await uploadToS3(files[fields.type][0].filepath, fields.type, fields.id)
                });
            } catch (error) {
                console.error(error);
                if (Array.isArray(error)) {
                    response.errors.push(...error.map(err => String(err)));
                } else {
                    response.errors.push(String(error));
                }
                return finish(response, files);
            }
    
            console.log(`${fields.id} ${fields.type} updated`);
            return finish(response, files);
        });
    });
};

const scannerHttpApi = {
    request: async (req, res, resource) => {
        const username = req.headers.username;
        const password = req.headers.password;
        const user = (await scannerApi.getUsers())[username];
        if ((!username || !password) || !user || !user.password || (user.password !== password)) {
            res.json({errors: ['access denied'], warnings: [], data: {}});
            return;
        }
        let response = false;
        let options = {};
        if (resource === 'image') {
            response = await submitImage(req, user);
        }
        if (!response) {
            options = req.body;
            if (typeof options !== 'object') {
                options = {};
            }
            options = await scannerApi.getOptions(options, user);
        }
        if (resource === 'json') {
            if (user.flags & scannerApi.userFlags.jsonDownload) {
                response = getJson(options);
            } else {
                return res.json({errors: ['You are not authorized to perform that action'], warnings: [], data: {}});
            }
        }
        if (resource === 'submit-data') {
            if (user.flags & scannerApi.userFlags.submitData) {
                response = scannerApi.submitJson(req.body);
            } else {
                return res.json({errors: ['You are not authorized to perform that action'], warnings: [], data: {}});
            }
        }
        try {
            const scannerName = req.headers.scanner;
            if (!scannerName && !response) {
                res.json({errors: ['no scanner name specified'], warnings: [], data: {}});
                return;
            }
            options.scannerName = scannerName;
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
                options.scanner = await scannerApi.getScanner(options, false);
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
        } catch (error) {
            console.log('Scanner API Error', error);
            res.json({errors: [String(error)], warnings: [], data: {}});
            return;
        }
        if (response) {
            res.json(response);
            return;
        }
        res.json({errors: ['unrecognized request'], warnings: [], data: {}});
    },
};

export default scannerHttpApi;
