import fs from 'node:fs';
import path from 'node:path';

import cloudflare from './cloudflare.mjs';
import stellate from './stellate.mjs';
import TranslationHelper from './translation-helper.mjs';
import { query, jobComplete, maxQueryRows } from'./db-connection.mjs';
import JobLogger from './job-logger.mjs';
import { alert } from './webhook.js';
import webSocketServer from './websocket-server.mjs';
import tarkovData from'./tarkov-data.mjs';
import normalizeName from './normalize-name.js';
import gameModes from './game-modes.mjs';

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
        if (options.jobManager) this.jobManager = options.jobManager;

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
            ...options.saveFields,
        ];
        this.writeFolder = 'dumps';
        this.maxQueryRows = maxQueryRows;
        this.gameModes = gameModes;
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
        this.startDate = new Date();
        this.kvData = {};
        this.locales = await tarkovData.locales();
        this.translationHelper = new TranslationHelper({
            locales: this.locales,
            logger: this.logger,
        })
        this.translationKeyMap = {};
        this.translationKeys = new Set();
        if (options && options.parent) {
            this.logger.parentLogger = options.parent.logger;
        }
        if (this.running) {
            if (options && options.parent) {
                for (let parent = options.parent; parent; parent = parent.parent) {
                    if (parent.name === this.name) {
                        return Promise.reject(new Error(`Job ${this.name} is a parent of ${options.parent.name}, so ${options.parent.name} cannot run it`));
                    }
                }
                this.parent = options.parent;
            }
            this.logger.log(`${this.name} is already running; waiting for completion`);
            return this.running;
        }
        if (options && options.parent) {
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
        const webhookResults = await Promise.allSettled(this.discordAlertQueue);
        for (const messageResult of webhookResults) {
            if (messageResult.status !== 'rejected') {
                continue;
            }
            this.logger.error(`Error sending discord alert: ${messageResult.reason}`);
        }
        await Promise.allSettled(this.queries);
        this.cleanup();
        this.logger.end();
        if (!options?.parent) {
            await jobComplete();
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

    cloudflarePut = async (data, kvOverride) => {
        if (!data) {
            data = this.kvData;
        }
        data.locale = await this.fillTranslations();
        
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
        const response = await this.cloudflareUpload(kvName, data).catch(error => {
            this.logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        const uploadTime = new Date() - uploadStart;
        if (response.success) {
            this.writeDump(data, kvName);
            this.logger.success(`Successful Cloudflare put of ${kvName} in ${uploadTime} ms`);
            stellate.purge(kvName, this.logger);
        } else {
            const errorMessages = [];
            for (let i = 0; i < response.errors.length; i++) {
                this.logger.error(response.errors[i]);
                errorMessages.push(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                this.logger.error(response.messages[i]);
            }
            if (errorMessages.length > 0) {
                return Promise.reject(new Error(`Error uploading kv data: ${errorMessages.join(', ')}`));
            }
        }
    }

    cloudflareUpload = async (kvName, data) => {
        if (!this.idSuffixLength) {
            return cloudflare.put(kvName, data).catch(error => {
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
            this.writeDump(partData, `${kvName}_${hexKey}`);
            uploads.push(cloudflare.put(`${kvName}_${hexKey}`, partData).catch(error => {
                this.logger.error(error);
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

    query = async (sql, params) => {
        const queryPromise = query(sql, params);;
        this.queries.push(queryPromise);
        return queryPromise;
    }

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
}

export default DataJob;
