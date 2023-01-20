const fs = require('fs');
const path = require('path');

const chalk = require('chalk');

const writeLog = (jobName, messages) => {
    try {
        fs.mkdirSync(path.join(__dirname, '..', 'logs'));
    } catch (error) {
        if (error.code !== 'EEXIST') {
            console.log(error);
        }
    }
    try {
        fs.writeFileSync(path.join(__dirname, '..', 'logs', jobName+'.log'), JSON.stringify(messages, null, 4));
    } catch (error) {
        console.log(`Error writing log file for ${jobName}`, error);
    }
};

class JobLogger {
    constructor(jobName, writeLog = true) {
        this.jobName = jobName;
        this.startTime = new Date();
        this.messages = [];
        this.timers = {};
        this.writeLog = writeLog;
        this.verbose = process.env.VERBOSE_LOGS == 'true';
    }

    log(message) {
        if (this.verbose) console.log(message);
        if (typeof message === 'object') {
            message = JSON.stringify(message, null, 4);
        }
        this.messages.push(message);
    }

    error(message) {
        if (typeof message === 'string') {
            message = chalk.red(message);
        } else if (typeof message === 'object') {
            if (message.stack) {
                message = chalk.red(`${new Date()}`)+'\n'+message.stack;
            } else {
                message = chalk.red(`${new Date()}\n${message.toString()}`);
            }
        }
        if (this.verbose) console.log(message);
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
        if (this.verbose) console.log(message);
        this.messages.push(message);
    }

    succeed(message) {
        if (typeof message === 'string') {
            message = chalk.green(message);
        } else if (typeof message === 'object') {
            message = JSON.stringify(message, null, 4);
        }
        if (this.verbose) console.log(message);
        this.messages.push(message);
    }

    success(message) {
        this.succeed(message);
    }

    end() {
        const endMessage = `${this.jobName} ended in ${new Date() - this.startTime}ms`;
        this.log(endMessage);
        //if (this.verbose) console.log(endMessage);
        if (this.writeLog) writeLog(this.jobName, this.messages);
        this.messages.length = 0;
    }

    time(label) {
        this.timers[label] = new Date();
    }

    timeEnd(label) {
        if (!this.timers[label]) return;
        const endMessage = `${label} completed in ${new Date - this.timers[label]}ms`;
        this.log(endMessage);
        delete this.timers[label];
    }

    write() {
        this.log(`${this.jobName} ended in ${new Date() - this.startTime}ms`);
        writeLog(this.jobName, this.messages);
    }
}

module.exports = JobLogger;
