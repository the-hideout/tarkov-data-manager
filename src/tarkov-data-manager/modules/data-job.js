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
            'logger',
            'name',
            //'running',
            'saveFields',
            'selfLogger',
            ...options.saveFields,
        ];
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
        if (options && options.parent) {
            this.selfLogger = this.logger;
            this.logger = options.parent.logger;
        }
        if (this.running) {
            //return Promise.reject(`${this.name} is already running`);
            this.logger.log(`${this.name} is already running; waiting for completion`);
            return this.running;
        }
        let returnValue;
        try {
            this.running = this.run(options);
            returnValue = await this.running;
        } catch (error) {
            this.logger.error(error);
            alert({
                title: `Error running ${this.name} job`,
                message: error.stack
            });
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
        return returnValue;
    }

    async run(options) {
        this.logger.error('run method not implemented');
    }

    cloudflarePut = async (kvName, data) => {
        if (typeof data !== 'string') {
            data = JSON.stringify(data);
        }
        const response = await cloudflare.put(kvName, data).catch(error => {
            this.logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            this.logger.success(`Successful Cloudflare put of ${kvName}`);
            await stellate.purgeTypes(kvName, this.logger);
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
