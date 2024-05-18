import fs from 'node:fs';
import path from 'node:path';

import cloudflare from './cloudflare.mjs';
import stellate from './stellate.mjs';
import { query, jobComplete, maxQueryRows } from'./db-connection.mjs';
import JobLogger from './job-logger.js';
import { alert } from './webhook.js';
import webSocketServer from './websocket-server.mjs';
import tarkovData from'./tarkov-data.mjs';

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
            ...options.saveFields,
        ];
        this.writeFolder = 'dumps';
        this.warnOnTranslationKeySubstitution = false;
        this.maxQueryRows = maxQueryRows;
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
        await this.fillTranslations(data);
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

    addTranslation = (key, langCode, value) => {
        if (!this.kvData.locale) {
            this.kvData.locale = {};
        }
        if (typeof langCode === 'function') {
            if (typeof key === 'string') {
                for (const langC in this.locales) {    
                    if (!this.kvData.locale[langC]) {
                        this.kvData.locale[langC] = {};
                    }
                    this.kvData.locale[langC][key] = langCode(this.locales[langC], langC);
                }
            } else if (Array.isArray(key)) {
                for (const k of key) {    
                    for (const langC in this.locales) {   
                        if (!this.kvData.locale[langC]) {
                            this.kvData.locale[langC] = {};
                        }
                        this.kvData.locale[langC][k] = langCode(k, this.locales[langC], langC);
                    }
                }
            } else {
                this.logger.warn(`${typeof key} is not a valid translation key`);
            }
            return key;
        }
        if (Array.isArray(key)) {
            for (const k of key) {
                if (!this.kvData.locale[k]){
                    this.kvData.locale[k] = {};
                }
                if (langCode && value) {
                    if (!this.kvData.locale[langCode]) {
                        this.kvData.locale[langCode] = {};
                    }
                    this.kvData.locale[langCode][key] = value;
                } else {
                    this.translationKeys.add(k);
                }
            }
            return key;
        }
        if (langCode) {
            if (typeof value !== 'undefined') {
                if (!this.kvData.locale[langCode]) {
                    this.kvData.locale[langCode] = {};
                }
                this.kvData.locale[langCode][key] = value;
            } else {
                throw new Error(`Cannot assign undefined value to ${langCode} ${key}`);
            }
        } else {
            if (typeof this.locales.en[key] !== 'undefined') {
                this.translationKeys.add(key);
            } else if (!this.translationKeyMap[key]) {
                if (typeof this.locales.en[key] === 'undefined') {
                    for (const dictKey in this.locales.en) {
                        if (dictKey.toLowerCase() === key.toLowerCase()) {
                            this.translationKeyMap[key] = dictKey;
                            if (this.warnOnTranslationKeySubstitution) {
                                this.logger.warn(`Translation key substition for ${key}: ${dictKey}`);
                            }
                            //return dictKey;
                            break;
                        }
                    }
                }
                if (!this.translationKeyMap[key]) {
                    this.logger.warn(`Translation key not found: ${key}`);
                }
                this.translationKeys.add(key);
            }
        }
        return key;
    }

    mergeTranslations = (newTranslations, target) => {
        if (!target) {
            target = this.kvData;
        }
        if (!target.locale) {
            target.locale = {};
        }
        for (const langCode in newTranslations) {
            if (!target.locale[langCode]) {
                target.locale[langCode] = {};
            }
            for (const key in newTranslations[langCode]) {
                if (target.locale[langCode][key]) {
                    continue;
                }
                target.locale[langCode][key] = newTranslations[langCode][key];
            }
        }
    }

    removeTranslation = (key, target) => {
        if (!target) {
            target = this.kvData;
        }
        if (!target.locale) {
            target.locale = {};
        }
        for (const langCode in target.locale) {
            target.locale[langCode][key] = undefined;
        }
    }

    getTranslation = (key, langCode = 'en', target) => {
        if (!target) {
            target = this.kvData;
        }
        if (!target.locale) {
            target.locale = {};
        }
        if (!target.locale[langCode]) {
            target.locale[langCode] = {};
        }
        if (typeof target.locale[langCode][key] !== 'undefined') {
            return target.locale[langCode][key];
        }
        const usedKey = this.translationKeyMap[key] ? this.translationKeyMap[key] : key;
        if (typeof usedKey === 'function') {
            target.locale[langCode][key] = usedKey(key, langCode, this.locales[langCode]);
            return target.locale[langCode][key];
        }
        target.locale[langCode][key] = this.locales[langCode][usedKey];
        if (typeof target.locale[langCode][key] === 'undefined' && langCode === 'en') {
            target.locale[langCode][key] = usedKey;
            //return Promise.reject(new Error(`Missing translation for ${key}`));
        }
        return target.locale[langCode][key];
    }

    fillTranslations = async (target) => {
        if (!target) {
            target = this.kvData;
        }
        if (!target.locale) {
            return;
        }
        for (const langCode in this.locales) {
            if (!target.locale[langCode]) {
                target.locale[langCode] = {};
            }
            for (const key of this.translationKeys) {
                this.getTranslation(key, langCode, target);
            }
        }
        for (const langCode in target.locale) {
            if (langCode === 'en') {
                continue;
            }
            for (const key in target.locale[langCode]) {
                if (target.locale.en[key] === target.locale[langCode][key]) {
                    delete target.locale[langCode][key];
                }
            }
            if (Object.keys(target.locale[langCode]).length < 1) {
                delete target.locale[langCode];
            }
        }
    }

    query = async (sql, params) => {
        const queryPromise = query(sql, params);;
        this.queries.push(queryPromise);
        return queryPromise;
    }

    getMobKey = (enemy) => {
        const keySubs = {
            arenaFighterEvent: 'ArenaFighterEvent',
            followerTagilla: 'bossTagilla',
            AnyPmc: 'AnyPMC',
            exUsec: 'ExUsec',
            marksman: 'Marksman',
            pmcBot: 'PmcBot',
            savage: 'Savage',
        };
        return keySubs[enemy] || enemy;
    }

    addMobTranslation = (key) => {
        if (typeof this.locales.en[key] !== 'undefined') {
            this.translationKeys.add(key);
        } else if (typeof this.translationKeyMap[key] === 'undefined') {
            let foundKey = this.getMobKey(key);
            let found = false;
            if (enemyKeyMap[key]) {
                foundKey = enemyKeyMap[key];
            }
            if (this.locales.en[foundKey]) {
                this.translationKeyMap[key] = foundKey;
                found = true;
            }
            const enemyKeys = [
                `QuestCondition/Elimination/Kill/BotRole/${foundKey}`,
                `QuestCondition/Elimination/Kill/Target/${foundKey}`,
                `ScavRole/${foundKey}`,
            ];
            for (const enemyKey of enemyKeys) {
                if (found) {
                    break;
                }
                if (this.locales.en[enemyKey]) {
                    this.translationKeyMap[key] = enemyKey;
                    found = true;
                    break;
                }
            }
            
            if (key.includes('follower') && !key.includes('BigPipe') && !key.includes('BirdEye')) {
                this.translationKeyMap[key] = (key, langCode, lang) => {    
                    const nameParts = [];
                    const guardTypePattern = /Assault|Security|Scout|Snipe/;
                    const bossKey = key.replace('follower', 'boss').replace(guardTypePattern, '');
                    this.addMobTranslation(bossKey);
                    this.addMobTranslation('Follower');
                    nameParts.push(this.getTranslation(bossKey, langCode));
                    nameParts.push(this.getTranslation('Follower', langCode));
                    const guardTypeMatch = key.match(guardTypePattern);
                    if (guardTypeMatch) {
                        if (lang[`follower${guardTypeMatch[0]}`]) {
                            nameParts.push(`(${lang[`follower${guardTypeMatch[0]}`]})`);
                        } else {
                            nameParts.push(`(${guardTypeMatch[0]})`);
                        }
                    }
                    return nameParts.join(' ');
                };
            }
            if (key === 'peacefullZryachiyEvent') {
                this.addMobTranslation('bossZryachiy');
                this.translationKeyMap[key] = (key, langCode, lang) => {
                    return `${this.getTranslation('bossZryachiy', langCode)} (${lang.Peaceful || 'Peaceful'})`;
                };
            }
            if (key === 'ravangeZryachiyEvent') {
                this.addMobTranslation('bossZryachiy');
                this.translationKeyMap[key] = (key, langCode, lang) => {
                    return `${this.getTranslation('bossZryachiy', langCode)} (${lang['6530e8587cbfc1e309011e37 ShortName'] || 'Vengeful'})`;
                };
                
            }
            if (key === 'sectactPriestEvent') {
                this.addMobTranslation('sectantPriest');
                this.translationKeyMap[key] = (key, langCode, lang) => {
                    return `${this.getTranslation('sectantPriest', langCode)} (${lang.Ritual})`;
                };
            }
            for (const enemyKey of enemyKeys) {
                if (found) {
                    break;
                }
                for (const key in this.locales.en) {
                    if (key.toLowerCase() === enemyKey.toLowerCase()) {
                        this.translationKeyMap[key] = enemyKey;
                        found = true;
                        break;
                    }
                }
            }

            if (!this.translationKeyMap[key]) {
                this.logger.warn(`Translation key not found: ${key}`);
            }
            this.translationKeys.add(key);
        }
        return key;
    }

    hasTranslation = (key, langCode = 'en') => {
        let deepSearch = false;
        if (typeof langCode === 'boolean') {
            deepSearch = langCode;
            langCode = 'en';
        }
        if (typeof this.locales[langCode][key] !== 'undefined') {
            return true;
        }
        if (!deepSearch) {
            return false;
        }
        for (const k in this.locales.en) {
            if (k.toLowerCase() === key.toLowerCase()) {
                return true;
            }
        }
        return false;
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

const enemyKeyMap = {
    //'assault': 'ArenaFighterEvent',
    'scavs': 'Savage',
    'sniper': 'Marksman',
    'sectantWarrior': 'cursedAssault',
    'bossZryachiy': '63626d904aa74b8fe30ab426 ShortName',
};

export default DataJob;
