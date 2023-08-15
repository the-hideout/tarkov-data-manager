const path = require('path');

const cloudflare = require('../modules/cloudflare');
const stellate = require('../modules/stellate');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('./job-logger');
const { alert } = require('./webhook');
const tarkovData = require('./tarkov-data');

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

        if (!this.name) this.name = path.basename(__filename, '.js');
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
            ...options.saveFields,
        ];
        this.writeFolder = 'dumps';
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
        if (typeof data !== 'string') {
            data = JSON.stringify(data);
        }
        const uploadStart = new Date();
        const response = await cloudflare.put(kvName, data).catch(error => {
            this.logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        const uploadTime = new Date() - uploadStart;
        if (response.success) {
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
                    if (!this.kvData.local[langCode]) {
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
                this.kvData.locale[langCode][key] = value;
            } else {
                throw new Error(`Cannot assign undefined value to ${langCode} ${key}`);
            }
        } else {
            if (typeof this.locales.en[key] !== 'undefined') {
                this.translationKeys.add(key);
            } else {
                let newKey = key;
                for (const dictKey in this.locales.en) {
                    if (dictKey.toLowerCase() === key.toLowerCase()) {
                        newKey = dictKey;
                        break;
                    }
                }
                this.translationKeys.add(newKey);
            }
        }
        return key;
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
                if (target.locale[langCode][key]) {
                    continue;
                }
                target.locale[langCode][key] = this.locales[langCode][key];
                /*if (typeof target.locale[langCode][key] === 'undefined') {
                    for (const dictKey in this.locales[langCode]) {
                        if (dictKey.toLowerCase() === key.toLowerCase()) {
                            target.locale[langCode][key] = this.locales[langCode][dictKey];
                            break;
                        }
                    }
                }*/
                if (typeof target.locale[langCode][key] === 'undefined' && langCode === 'en') {
                    this.logger.error(`Missing translation for ${key}`);
                }
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
            followerTagilla: 'bossTagilla',
        };
        return keySubs[enemy] || enemy;
    }

    getMobName = (enemy, lang, langCode, originalLang) => {
        const originalEnemy = enemy;
        if (enemyMap[enemy]) {
            enemy = enemyMap[enemy];
        }
        if (lang[enemy]) {
            return lang[enemy];
        }
        const enemyKeys = [
            `QuestCondition/Elimination/Kill/BotRole/${enemy}`,
            `QuestCondition/Elimination/Kill/Target/${enemy}`,
            `ScavRole/${enemy}`,
        ];
        for (const enemyKey of enemyKeys) {
            for (const key in lang) {
                if (key.toLowerCase() === enemyKey.toLowerCase()) {
                    return lang[key];
                }
            }
        }
        if (enemy.includes('follower') && !enemy.includes('BigPipe') && !enemy.includes('BirdEye')) {
            const nameParts = [];
            const guardTypePattern = /Assault|Security|Scout|Snipe/;
            const bossKey = enemy.replace('follower', 'boss').replace(guardTypePattern, '');
            nameParts.push(this.getMobName(bossKey, lang, langCode));
            nameParts.push(this.getMobName('Follower', lang, langCode));
            const guardTypeMatch = enemy.match(guardTypePattern);
            if (guardTypeMatch) {
                if (lang[`follower${guardTypeMatch[0]}`]) {
                    nameParts.push(`(${lang[`follower${guardTypeMatch[0]}`]})`);
                } else {
                    nameParts.push(`(${guardTypeMatch[0]})`);
                }
            }
            return nameParts.join(' ')
        }
        if (langCode === 'en') {
            if (!originalLang) {
                this.logger.warn(`Could not find translation for ${originalEnemy}, ${langCode}`);
            }
        } else {
            return this.getMobName(originalEnemy, this.locales.en, 'en', langCode);
        }
        return enemy.replace('boss', '');
    }
}

const enemyMap = {
    'assault': 'ArenaFighterEvent',
    'scavs': 'Savage',
    'sniper': 'Marksman',
    'sectantWarrior': 'cursedAssault',
    'bossZryachiy': '63626d904aa74b8fe30ab426 ShortName',
};

module.exports = DataJob;
