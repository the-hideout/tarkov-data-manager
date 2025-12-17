import fs from 'node:fs';
import path from 'node:path';
import { setMaxListeners } from 'node:events';

import  { EmbedBuilder } from 'discord.js';
import { DateTime } from 'luxon';
import sharp from 'sharp';

import cloudflare from './cloudflare.mjs';
import TranslationHelper from './translation-helper.mjs';
import dbConnection from'./db-connection.mjs';
import JobLogger from './job-logger.mjs';
import { alert, send as sendWebhook } from './webhook.mjs';
import webSocketServer from './websocket-server.mjs';
import tarkovData from'./tarkov-data.mjs';
import normalizeName from './normalize-name.js';
import gameModes from './game-modes.mjs';
import emitter from './emitter.mjs';
import { createAndUploadFromSource } from './image-create.mjs';
import s3 from '../modules/upload-s3.mjs';
import tarkovDevData from './tarkov-data-tarkov-dev.mjs';

const verbose = false;

const activeJobs = new Set();

class DataJob {
    constructor(options) {
        if (typeof options === 'string') {
            options = {name: options};
        }
        if (typeof options === 'undefined') {
            options = {};
        }
        if (!options.saveFields) {
            options.saveFields = [];
        }
        if (options.name) this.name = options.name;
        if (options.jobManager) {
            this.jobManager = options.jobManager;
        }

        if (this.name && this.jobManager) {
            this.lastCompletion = this.jobManager.lastRun(this.name);
        }

        if (!this.name) this.name = path.basename(import.meta.filename, '.mjs');
        this.logger = new JobLogger(this.name);
        this.running = false;
        this.saveFields = [
            'jobManager',
            'kvName',
            'logger',
            'name',
            //'running',
            'saveFields',
            'selfLogger',
            'writeFolder',
            'idSuffixLength',
            'apiType',
            'maxQueryRows',
            'gameModes',
            'lastCompletion',
            'loadLocales',
            'cronTrigger',
            'eventTrigger',
            'terminateIfRunning',
            'alreadyRunningCount',
            ...options.saveFields,
        ];
        this.writeFolder = 'dumps';
        this.maxQueryRows = dbConnection.maxQueryRows;
        this.gameModes = gameModes;
        this.terminateIfRunning = 1;
        this.alreadyRunningCount = 0;
        this.loadLocales = !!options.loadLocales;
    }

    cleanup() {
        for (const fieldName in this) {
            if (typeof this[fieldName] === 'function') {
                continue;
            }
            if (this.saveFields.includes(fieldName)) {
                continue;
            }
            delete this[fieldName];
        }
    }

    async start(options) {
        if (this.running) {
            if (options?.parent) {
                for (let parent = options.parent; parent; parent = parent.parent) {
                    if (parent.name === this.name) {
                        return Promise.reject(new Error(`Job ${this.name} is a parent of ${options.parent.name}, so ${options.parent.name} cannot run it`));
                    }
                }
                if (!this.parent) {
                    this.parent = options.parent;
                } else {
                    options.parent.logger.log(`${this.name} is already has parent job ${options.parent.name}`);
                }
                options.parent.logger.log(`${this.name} is already running; waiting for completion`);
                return this.running;
            }
            this.alreadyRunningCount++;
            if (this.alreadyRunningCount >= this.terminateIfRunning) {
                this.abortController.abort();
                return Promise.reject(new Error(`Aborted job already running; started ${DateTime.fromJSDate(this.startDate).toRelative()}`));
            } else {
                return Promise.reject(new Error(`Job already running; started ${DateTime.fromJSDate(this.startDate).toRelative()}`));
            }
        }
        if (options?.parent) {
            this.logger.parentLogger = options.parent.logger;
        }
        this.alreadyRunningCount = 0;
        this.abortController = new AbortController();
        if (options?.parent) {
            options.parent.abortController.signal.addEventListener('abort', this.abort, { once: true });
        }
        setMaxListeners(17, this.abortController.signal);
        this.startDate = new Date();
        this.kvData = {};
        this.jobSummary = {
            general: [],
        };
        if (this.loadLocales) {
            this.locales = await tarkovData.locales();
            this.translationHelper = new TranslationHelper({
                locales: this.locales,
                logger: this.logger,
            });
        }
        if (options?.parent) {
            this.parent = options.parent;
        }
        this.discordAlertQueue = [];
        this.queries = [];
        this.logger.start();
        let returnValue;
        let throwError = false;
        try {
            if (verbose) {
                activeJobs.add(this.name);
                alert({
                    title: `Starting ${this.name} job`,
                    message: `Running jobs: ${[...activeJobs].join(', ')}`,
                });
            }
            this.running = this.run(options);
            returnValue = await this.running;
            if (verbose) {
                activeJobs.delete(this.name);
                alert({
                    title: `Finished ${this.name} job`,
                    message: `Running jobs: ${[...activeJobs].join(', ')}`,
                });
            }
        } catch (error) {
            if (this.parent) {
                if (verbose) {
                    activeJobs.delete(this.name);
                    alert({
                        title: `Error running ${this.name} job as child of ${this.parent.name}`,
                        message: `Running jobs: ${[...activeJobs].join(', ')}`,
                    });
                }
                throwError = error;
            } else {
                this.logger.error(error);
                alert({
                    title: `Error running ${this.name} job`,
                    message: error.stack
                });
            }
        }
        if (this.jobSummary.general.length > 0 || Object.keys(this.jobSummary).length > 1) {
            const embeds = [];
            for (const messageType in this.jobSummary) {
                let embed = new EmbedBuilder();
                embeds.push(embed);
                if (messageType === 'general') {
                    embed.setTitle(`${this.name} job`);
                } else {
                    embed.setTitle(messageType);
                }
                let embedMessage = '';
                if (this.jobSummary[messageType].length > 0) {
                    for (let message of this.jobSummary[messageType]) {
                        if (message.length > 4096) {
                            message = message.substring(0, 4092)+'...';
                        }
                        if (embedMessage.length + message.length > 4096) {
                            embed.setDescription(embedMessage.trim());
                            embed = new EmbedBuilder();
                            embeds.push(embed);
                            embed.setTitle('(cont)');
                            embedMessage = message;
                            continue;
                        }
                        embedMessage += '\n' + message;
                    }
                    embed.setDescription(embedMessage.trim());
                }
            }
            //embeds[embeds.length - 1].setFooter({text: new Date().toLocaleString()});
            this.discordAlertQueue.push(sendWebhook({embeds}, this.logger));
        }
        const webhookResults = await Promise.allSettled(this.discordAlertQueue);
        for (const messageResult of webhookResults) {
            if (messageResult.status !== 'rejected') {
                continue;
            }
            this.logger.error(`Error sending discord alert: ${messageResult.reason}`);
        }
        await Promise.allSettled(this.queries);
        this.cleanup();
        if (options?.parent) {
            options.parent.abortController.signal.removeEventListener('abort', this.abort);
        }
        this.logger.end();
        if (this.name && this.jobManager) {
            this.lastCompletion = this.jobManager.lastRun(this.name);
        }
        if (this.name) {
            emitter.emit(`jobComplete_${this.name}`);
        }
        if (!options?.parent) {
            if (process.env.TEST_JOB === 'true') {
                webSocketServer.close();
            }
        }
        if (throwError) {
            return Promise.reject(throwError);
        }
        return returnValue;
    }

    async run() {
        this.logger.error('run method not implemented');
    }

    cloudflarePut = async (data, kvOverride, gameMode) => {
        if (!data) {
            data = this.kvData;
        }
        if (this.loadLocales) {
            data.locale = await this.fillTranslations();
        }
        
        let kvName = kvOverride || this.kvName;
        if (!kvName) {
            return Promise.reject(new Error('Must set kvName property before calling cloudflarePut'));
        }
        data.updated = new Date();
        const nextInvocation = this.parent ? this.parent.nextInvocation : this.nextInvocation;
        if (nextInvocation) {
            const startDate = this.parent ? this.parent.startDate : this.startDate;
            const processTime = new Date() - startDate;
            const expireDate = new Date(nextInvocation);
            expireDate.setMilliseconds(expireDate.getMilliseconds() + processTime);
            expireDate.setMinutes(expireDate.getMinutes() + 2);
            data.expiration = expireDate;
        }
        const uploadStart = new Date();
        const response = await this.cloudflareUpload(kvName, data, gameMode).catch(error => {
            this.logger.error(error);
            this.logger.warn(`Error during Cloudflare put of ${kvName} (${JSON.stringify(data).length.toLocaleString()} bytes)`);
            return {success: false, errors: [], messages: []};
        });
        if (gameMode && gameMode !== 'regular') {
            kvName += `_${gameMode}`;
        }
        const uploadTime = new Date() - uploadStart;
        if (response.success) {
            this.writeDump(data, kvName);
            this.logger.success(`Successful Cloudflare put of ${kvName} in ${uploadTime} ms (${JSON.stringify(data).length.toLocaleString()} bytes)`);
            //stellate.purge(kvName, this.logger);
        } else {
            response.messages?.forEach(message => this.logger.error(message));
            if (response.errors.length > 0) {
                return Promise.reject(new Error(`Error uploading kv data: ${response.errors.map(error => error.message).join(', ')}`));
            }
        }
    }

    cloudflareUploadBulk = async (kvArray, gameMode) => {
        return cloudflare.putBulk(kvArray, {signal: this.abortController.signal}).catch(error => {
            this.logger.error(error);
            return {success: false, errors: [], messages: []};
        });
    }

    cloudflareUpload = async (kvName, data, gameMode) => {
        if (!this.idSuffixLength) {
            return cloudflare.put(kvName, data, {signal: this.abortController.signal}).catch(error => {
                this.logger.error(error);
                return {success: false, errors: [], messages: []};
            });
        }
        const uploads = [];
        for (const hexKey of this.getIdSuffixKeys()) {
            const partData = {
                updated: data.updated,
                expiration: data.expiration,
            };
            partData[this.apiType] = Object.keys(data[this.apiType]).reduce((matching, id) => {
                if (id.endsWith(hexKey)) {
                    matching[id] = data[this.apiType][id];
                }
                return matching;
            }, {});
            let idKey = `${kvName}_${hexKey}`;
            if (gameMode && gameMode !== 'regular') {
                idKey += `_${gameMode}`;
            }
            this.writeDump(partData, idKey);
            uploads.push(cloudflare.put(idKey, partData, {signal: this.abortController.signal}).catch(error => {
                this.logger.error(JSON.stringify(error));
                return {success: false, errors: [], messages: []};
            }));
        }
        const uploadResults = await Promise.allSettled(uploads);
        const totalResults = {success: true, errors: [], messages: []};
        for (const uploadResult of uploadResults) {
            if (uploadResult.status === 'fulfilled') {
                totalResults.messages.push(...uploadResult.value.messages);
                totalResults.errors.push(...uploadResult.value.errors);
                if (!uploadResult.value.success) {
                    totalResults.success = false;
                }
            }
            if (uploadResult.status === 'rejected') {
                totalResults.success = false;
                totalResults.errors.push(uploadResult.reason);
            }
        }
        return totalResults;
    }

    writeDump = (data = false, filename = false) => {
        if (!data) {
            data = this.kvData;
        }
        if (!filename) {
            filename = this.kvName;
        }
        const newName = path.join(import.meta.dirname, '..', 'dumps', `${filename.toLowerCase()}.json`);
        const oldName = newName.replace('.json', '_old.json');
        try {
            fs.renameSync(newName, oldName);
        } catch (error) {
            // do nothing
        }
        fs.writeFileSync(newName, JSON.stringify(data, null, 4));
        //fs.writeFileSync(newName, value);
    }

    discordAlert = async (options) => {
        const messagePromise = alert(options, this.logger);
        this.discordAlertQueue.push(messagePromise);
        return messagePromise;
    }

    normalizeName = (name) => {
        return normalizeName(name);
    }

    addTranslation = (key, langCode, value) => {
        return this.translationHelper.addTranslation(key, langCode, value);
    }

    mergeTranslations = (newTranslations, target) => {
        return this.translationHelper.mergeTranslations(newTranslations, target);
    }

    removeTranslation = (key, target) => {
        return this.translationHelper.removeTranslation(key, target);
    }

    getTranslation = (key, langCode = 'en', target) => {
        return this.translationHelper.getTranslation(key, langCode, target);
    }

    fillTranslations = async (target) => {
        return this.translationHelper.fillTranslations(target);
    }

    getMobKey = (enemy) => {
        return this.translationHelper.getMobKey(enemy);
    }

    addMobTranslation = (key) => {
        return this.translationHelper.addMobTranslation(key);
    }

    hasTranslation = (key, langCode = 'en') => {
        return this.translationHelper.hasTranslation(key, langCode);
    }

    query = (sql, values, options) => {
        if (typeof values === 'object' && !Array.isArray(values)) {
            options = values;
            values = undefined;
        }
        const queryPromise = dbConnection.query(sql, values, {signal: this.abortController.signal, ...options});
        this.queries.push(queryPromise);
        return queryPromise;
    }

    batchQuery = (sql, values, batchCallback, options) => {
        if (values && !Array.isArray(values)) {
            batchCallback = values;
            values = [];
        }
        if (!options && typeof batchCallback !== 'function') {
            options = batchCallback;
            batchCallback = undefined;
        }
        const queryPromise = dbConnection.batchQuery(sql, values, batchCallback, {signal: this.abortController.signal, ...options});
        this.queries.push(queryPromise);
        return queryPromise;
    }

    d1Query = cloudflare.d1Query;

    getIdSuffix(id) {
        if (!this.idSuffixLength) {
            throw new Error('idSuffixLength must be set before calling getIdSuffix');
        }
        return id.substring(id.length-this.idSuffixLength, id.length);
    }

    getIdSuffixKeys = () => {
        if (!this.idSuffixLength) {
            throw new Error('idSuffixLength must be set before calling getIdSuffixKeys');
        }
        const keys = [];
        const maxDecimalValue = parseInt('f'.padEnd(this.idSuffixLength, 'f'), 16);
        for (let i = 0; i <= maxDecimalValue; i++) {
            keys.push(i.toString(16).padStart(this.idSuffixLength, '0'));
        }
        return keys;
    }

    jobOutput = (jobName, options = {}) => {
        const defaultOptions = {
            gameMode: 'regular',
            rawOutput: false,
        };
        options = {
            ...defaultOptions,
            ...options,
            parentJob: this,
        };
        return this.jobManager.jobOutput(jobName, options.parentJob, options.gameMode, options.rawOutput);
    }

    addJobSummary = (text, category = 'general') => {
        if (!this.jobSummary[category]) {
            this.jobSummary[category] = [];
        }
        this.jobSummary[category].push(text);
    }

    abort = (reason) => {
        this.abortController.abort(reason);
    }

    getWikiLink = (pageName) => {
        pageName = pageName.replace(/ \[\w+ ZONE\]$/, '');
        return `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(pageName.replaceAll(' ', '_').replaceAll('#', ''))}`;
    }

    customizationTypes() {
        return {
            hideout: [
                'Wall',
                'Floor',
                'Ceiling',
                'ShootingRangeMark',
            ],
            character: [
                'Body',
                'Feet',
                'Head',
                'Voice',
            ],
            other: [
                'Gestures',
                'MannequinPose',
                'DogTags',
                'EnvironmentUI',
            ],
        };
    }

    getCustomization(id) {
        const cust = this.customization[id];
        const customizationType = this.customization[cust._parent]._name;
        if (customizationType === 'Upper') {
            return {
                ...this.customization[cust._props.Body],
                original: cust,
            };
        }
        if (customizationType === 'Lower') {
            return {
                ...this.customization[cust._props.Feet],
                original: cust,
            };
        }
        return cust;
    }

    getCustomizationName(cust) {
        const customizationType = this.customization[cust._parent]._name;
        const custId = cust.original?._id ?? cust._id;
        let translationKey = `${custId} Name`;
        if (customizationType === 'MannequinPose') {
            translationKey = `Hideout/Mannequin/Pose/${cust._props.MannequinPoseName}`;
        }
        if (customizationType === 'Gestures') {
            translationKey = cust._props.Name;
        }
        if (customizationType === 'EnvironmentUI') {
            translationKey = cust._props.EnvironmentUIType;
        }
        if (customizationType === 'DogTags') {
            //return;
        }
        if (customizationType === 'Stub') {
            translationKey = 'UI/Quest/Reward/StubCaption';
        }
        return this.addTranslation(translationKey);
    }

    getCustomizationTypeName(cust) {
        const customizationType = this.customization[cust._parent]._name;
        let translationKey = `ECustomizationItemCategory/${customizationType}`;
        if (customizationType === 'Gestures') {
            translationKey = 'ECustomizationItemCategory/Gesture';
        }
        if (customizationType === 'EnvironmentUI') {
            translationKey = 'ECustomizationItemCategory/Environment';
        }
        if (customizationType === 'DogTags') {
            translationKey = 'ECustomizationItemCategory/DogTag';
        }
        if (this.customizationTypes().hideout.includes(customizationType)) {
            translationKey = `Hideout/Customization/${customizationType}/TabName`;
        }
        if (customizationType === 'Feet' || customizationType === 'Lower') {
            translationKey = 'Lower body';
        }
        if (customizationType === 'Body' || customizationType === 'Upper') {
            translationKey = 'Upper body';
        }
        return this.addTranslation(translationKey);
    }

    isValidCustomizationType(cust) {
        const customizationType = this.customization[cust._parent]._name;
        const validTypes = this.customizationTypes();
        for (const custTypeKey in validTypes) {
            if (validTypes[custTypeKey].includes(customizationType)) {
                return true;
            }
        }
        return false;
    }

    fenceFetch(path, options = {}) {
        return tarkovDevData.fenceFetch(path, {
            ...options,
            signal: this.abortController.signal,
        });
    }

    fenceFetchImage(path, options = {}) {
        return tarkovDevData.fenceFetchImage(path, {
            ...options,
            signal: this.abortController.signal,
        });
    }

    async getCustomizationImage(cust) {
        const customizationType = this.customization[cust._parent]._name;
        const custTypes = this.customizationTypes();
        const validImageTypes = [
            ...custTypes.hideout,
            ...custTypes.character,
            'Gestures',
        ];
        if (customizationType === 'Voice') {
            return;
        }
        if (!validImageTypes.includes(customizationType)) {
            return;
        }
        return this.retrieveImage({
            filename: `customization-${cust._id}.webp`,
            fetch: () => {
                return this.fenceFetch(`/customization-image/${cust._id}`);
            },
        });
    }

    async retrieveImage(options) {
        const s3FileName = options.filename;
        let fallback;
        if (options.fallback) {
            fallback = `https://${process.env.S3_BUCKET}/${options.fallback}`;
        }
        if (!options.filename) {
            return Promise.reject(new Error('options must include filename'));
        }
        const s3ImageLink = `https://${process.env.S3_BUCKET}/${s3FileName}`;
        if (this.s3Images.includes(s3FileName) && !options.forceDownload) {
            return s3ImageLink;
        }
        if (!options.fetch || typeof options.fetch !== 'function') {
            if (fallback) {
                return fallback;
            }
            return Promise.reject(new Error('options must include fetch function'));
        }
        const imageResponse = await options.fetch();
        if (!imageResponse.ok) {
            return fallback;
        }
        const imageType = s3FileName.split('.').pop();
        const image = sharp(await imageResponse.arrayBuffer());//.webp({lossless: true});
        if (imageType === 'webp' || options.imageOptions) {
            const imageOptions = options.imageOptions ?? {};
            if (imageType === 'webp' && !options.imageOptions) {
                imageOptions.lossless = true;
            }
            if (Object.keys(imageOptions).length) {
                image[imageType](imageOptions);
            }
        }
        const metadata = await image.metadata();
        if (metadata.width <= 1 || metadata.height <= 1) {
            return fallback;
        }
        this.logger.log(`Downloaded image ${s3FileName}`);
        await s3.uploadAnyImage(image, s3FileName, `image/${imageType}`);
        return s3ImageLink;
    }

    isSpecialSlotItem(dbItem) {
        const pockets = this.bsgItems['627a4e6b255f7527fb05a0f6'];
        if (!pockets) {
            throw new Error('pockets not found');
        }
        const specialItemSlot = pockets._props.Slots[0];
        if (!specialItemSlot) {
            throw new Error('special item slot not found');
        }
        let itemId = dbItem.id;
        if (dbItem.types.includes('preset')) {
            itemId = dbItem.properties.items[0]._tpl;
        }
        const allIds = [];
        let currentItem = this.bsgItems[itemId];
        if (currentItem._props.QuestItem) {
            return false;
        }
        while (currentItem) {
            allIds.push(currentItem._id);
            currentItem = this.bsgItems[currentItem._parent];
        }

        for (const id of specialItemSlot._props.filters[0].Filter) {
            if (allIds.includes(id)) {
                return true;
            }
        }
        return false;
    }

    isReplicaItem = (itemId) => {
        if (!this.items) {
            throw new Error ('this.items must be initialized to bsg items');
        }
        if (!this.items[itemId]?._props) {
            return false;
        }
        if (this.items[itemId]._props.MaximumNumberOfUsage) {
            return this.items[itemId]._props.MaximumNumberOfUsage > 1 && this.items[itemId]._props.MaximumNumberOfUsage <= 20;
        }
        if (this.items[itemId]._props.Resource) {
            return true;
        }
        // low durability weapons and armor setll for HIGHER prices
        // due to people leveling repair skills
        /*if (this.items[itemId]._props.MaxDurability && this.items[itemId]._props.armorClass !== '0' && !this.items[itemId]._props.knifeDurab) {
            return true;
        }*/
        return false;
    }

    getReplicaSettings = (bsgItem) => {
        const settings = {
            maxResourceField: 'Durability',
            usedResourceField: 'Repairable.Durability',
            filters: {
                conditionFrom: 0,
                onlyFunctional: false,
            },
        };
        if (bsgItem._props.MaximumNumberOfUsage) {
            settings.maxResourceField = 'MaximumNumberOfUsage';
            settings.usedResourceField = 'Key.NumberOfUsages';
        } else if (bsgItem._props.Resource) {
            settings.filters.maxResourceField = 'Resource';
            settings.filters.usedResourceField = 'Resource.Value';
        }
        return settings;
    }

    getReplicaItem = async (itemId) => {
        for (const item of this.itemData.values()) {
            if (item.types.includes('replica') && item.properties?.source === itemId) {
                return item;
            }
        }
        const bsgItem = this.items[itemId];
        const sourceItem = this.itemData.get(itemId);
        this.logger.log(`Must create replica of ${sourceItem.name}`);
        const idPrefix = '7265706C696361';
        let replicaNum = 0;
        let id;
        while (true) {
            id = `${idPrefix}${replicaNum.toString(16).padStart(10, '0')}`;
            if (!this.itemData.get(id)) {
                break;
            }
            presetNum++;
        }
        const replicaSettings = this.getReplicaSettings(bsgItem);
        //console.log(sourceItem.name, replicaSettings);
        const replicaName = `${sourceItem.name} (any%)`;
        return {
            id,
            name: replicaName,
        };
        await remoteData.addItem({
            id,
            name: replicaName,
            short_name: `${sourceItem.shortName} (any%)`,
            normalized_name: this.normalizeName(replicaName),
            base_price: sourceItem.base_price,
            width: sourceItem.width,
            height: sourceItem.height,
            properties: {
                backgroundColor: sourceItem.properties.backgroundColor,
                source: itemId,
                filters: replicaSettings.filters,
            },
        });
        await remoteData.addTypes(id, [...sourceItem.types, 'replica']);
        let itemImage;
        if (sourceItem.image_8x_link) {
            const response = await fetch(sourceItem.image_8x_link);
            if (response.ok) {
                const buffer = await response.arrayBuffer();
                itemImage = sharp(buffer);
            }
        }
        if (!itemImage) {
            itemImage = await this.fenceFetchImage(`/item-image/${sourceItem.id}`).catch(error => {
                this.logger.error(`Error generating image for ${replicaName} ${id}: error`);
            });
        }
        if (itemImage) {
            await createAndUploadFromSource(itemImage, id).catch(error => {
                this.logger.error(`Error creating image for ${replicaName} ${id}: error`);
            });
        }
    }
}

export default DataJob;
