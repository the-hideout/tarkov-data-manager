const {jobComplete} = require('../modules/db-connection');
const JobLogger = require('./job-logger');

class DataJob {
    constructor(options) {
        this.parent = false;
        if (typeof options.parent === 'object' && options.parent.constor === DataJob) {
            this.logger = options.parent.logger;
            this.data = options.parent.data;
            this.parent = options.parent;
        }
        if (options.name) this.name = options.name;

        if (!this.name) this.name = 'unnamed-job';
        if (!this.logger) this.logger = new JobLogger(this.name);
    }

    async run(runFunction) {
        try {
            await runFunction();
        } catch (error) {
            this.logger.error(error);
            alert({
                title: `Error running ${this.name} job`,
                message: error.stack
            });
        }
        if (!this.parent) {
            logger.end();
            await jobComplete();
        }
    }

    getTranslation(code, translateFunction) {
        let lang = this.data.locales[code];
        if (!lang) lang = locales.en;
        try {
            translateFunction(lang);
        } catch (error) {
            if (error.message.includes('Cannot read properties of undefined') && code !== 'en') {
                const attPattern = /\(reading '(.+)'\)/;
                const attMatch = error.message.match(attPattern)[1];
                this.logger.error(`Could not find attribute ${attMatch} for translation ${code}; defaulting to en`);
                translateFunction(this.data.locales.en);
            } else {
                throw error;
            }
        }
    }
}

module.exports = DataJob;