const fs = require('fs');
const path = require('path');

const chalk = require('chalk');

class JobLogger {
    constructor(jobName) {
        this.jobName = jobName;
        this.startTime = new Date();
        this.messages = [];
        this.timers = {};
    }

    log(message) {
        //console.log(message);
        if (typeof message === 'object') {
            message = JSON.stringify(message, null, 4);
        }
        this.messages.push(message);
    }

    error(message) {
        if (typeof message === 'string') {
            message = chalk.red(message);
        } else if (typeof message === 'object') {
            message = chalk.red(message.toString());
        }
        //console.log(message);
        this.messages.push(message);
    }

    fail(message) {
        this.error(message);
    }

    warn(message) {
        if (typeof message === 'string') {
            message = chalk.yellow(message);
        } else if (typeof message === 'object') {
            message = JSON.stringify(message, null, 4);
        }
        //console.log(message);
        this.messages.push(message);
    }

    succeed(message) {
        if (typeof message === 'string') {
            message = chalk.green(message);
        } else if (typeof message === 'object') {
            message = JSON.stringify(message, null, 4);
        }
        //console.log(message);
        this.messages.push(message);
    }

    success(message) {
        this.succeed(message);
    }

    end() {
        const endMessage = `${this.jobName} ended in ${new Date() - this.startTime}ms`;
        this.log(endMessage);
        console.log(endMessage);
        try {
            fs.mkdirSync(path.join(__dirname, '..', 'logs'));
        } catch (error) {
            if (error.code !== 'EEXIST') {
                console.log(error);
            }
        }
        try {
            fs.writeFileSync(path.join(__dirname, '..', 'logs', this.jobName+'.log'), JSON.stringify(this.messages, null, 4));
        } catch (error) {
            console.log(`Error writing log file for ${this.jobName}`, error);
        }
        this.messages.length = 0;
    }

    time(label) {
        this.timers[label] = new Date();
    }

    timeEnd(label) {
        if (!this.timers[label]) return;
        const endMessage = `${label} completed in ${new Date - this.timers[label]}ms`;
        this.log(endMessage);
        console.log(endMessage);
        delete this.timers[label];
    }
}

module.exports = JobLogger;