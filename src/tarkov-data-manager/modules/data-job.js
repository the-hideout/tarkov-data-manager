const path = require('path');

const cloudflare = require('../modules/cloudflare');
const stellate = require('../modules/stellate');
const {jobComplete} = require('../modules/db-connection');
const JobLogger = require('./job-logger');
const {alert} = require('./webhook');

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
        if (options && options.parent) {
            this.selfLogger = this.logger;
            this.logger = options.parent.logger;
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
        if (!this.selfLogger) {
            this.logger.start();
        }
        let returnValue;
        let throwError = false;
        try {
            this.running = this.run(options);
            returnValue = await this.running;
        } catch (error) {
            if (this.parent) {
                throwError = error;
            } else {
                this.logger.error(error);
                alert({
                    title: `Error running ${this.name} job`,
                    message: error.stack
                });
            }
        }
        //this.running = false;
        this.cleanup();
        if (!options?.parent) {
            this.logger.end();
            await jobComplete();
        } else {
            this.logger = this.selfLogger;
            delete this.selfLogger;
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
        let kvName = kvOverride || this.kvName;
        if (!kvName) {
            return Promise.reject(new Error('Must set kvName property before calling cloudflarePut'));
        }
        data.updated = new Date();
        if (this.nextInvocation) {
            const processTime = new Date() - this.startDate;
            const expireDate = new Date(this.nextInvocation);
            expireDate.setMilliseconds(expireDate.getMilliseconds() + processTime);
            expireDate.setMinutes(expireDate.getMinutes() + 1);
            data.expiration = expireDate;
        }
        if (typeof data !== 'string') {
            data = JSON.stringify(data);
        }
        const response = await cloudflare.put(kvName, data).catch(error => {
            this.logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            this.logger.success(`Successful Cloudflare put of ${kvName}`);
            stellate.purgeTypes(kvName, this.logger);
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                this.logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                this.logger.error(response.messages[i]);
            }
        }
    }
}

module.exports = DataJob;
