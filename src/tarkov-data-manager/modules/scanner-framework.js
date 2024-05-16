const { EventEmitter } = require('events');

const { query } = require('./db-connection');

const emitter = new EventEmitter();

const users = {};
let usersUpdating = true;

const userFlags = {
    disabled: 0,
    insertPlayerPrices: 1,
    insertTraderPrices: 2,
    trustTraderUnlocks: 4,
    skipPriceInsert: 8,
    jsonDownload: 16,
    overwriteImages: 32,
    submitData: 64,
};

const scannerFlags = {
    none: 0,
    ignoreMissingScans: 1,
    skipPriceInsert: 2
};

const scannerFramework = {
    createScanner: async (user, scannerName) => {
        if (!(userFlags.insertPlayerPrices & user.flags) && !(userFlags.insertTraderPrices & user.flags)) {
            throw new Error('User not authorized to insert prices');
        }
        if (user.scanners.length >= user.max_scanners) {
            throw new Error(`Could not find scanner with name ${scannerName} and user already ad maximum scanners (${options.user.max_scanners})`);
        }
        if (scannerName.match(/[^a-zA-Z0-9_-]/g)) {
            throw new Error('Scanner names can only contain letters, numbers, dashes (-) and underscores (_)');
        }
        try {
            const result = await query('INSERT INTO scanner (scanner_user_id, name) VALUES (?, ?)', [user.id, scannerName]);
            const newScanner = {id: result.insertId, name: scannerName, scanner_user_id: user.id, flags: 0};
            user.scanners.push(newScanner);
            return newScanner;
        } catch (error) {
            if (error.toString().includes('Duplicate entry')) {
                throw new Error(`Scanner ${scannerName} already exists`);
            }
            throw error;
        }
    },
    getScanner: async (options, createMissing) => {
        for (const scanner of options.user.scanners) {
            if (scanner.name === options.scannerName) {
                return scanner;
            }
        }
        if (!createMissing) {
            throw new Error(`Scanner with name ${options.scannerName} not found`);
        }
        const newScanner = await scannerFramework.createScanner(options.user, options.scannerName);
        return newScanner;
    },
    getUsers: async () => {
        if (usersUpdating) {
            await new Promise(resolve => {
                emitter.once('usersUpdated', resolve);
            });
        }
        return users;
    },
    refreshUsers: async () => {
        usersUpdating = true;
        try {
            const results = await query('SELECT * from scanner_user WHERE disabled=0');
            const scannerQueries = [];
            
            const users = await scannerFramework.getUsers();
            for (const username in users) {
                const newestUser = results.find(r => r.username === username);
                if (!newestUser) {
                    users[username] = undefined;
                    emitter.emit('userDisabled', username);
                    continue;
                }
                if (users[username].flags && !newestUser.flags) {
                    emitter.emit('userDisabled', username);
                }
            }
            for (const user of results) {
                const oldScanners = users[user.username]?.scanners || [];
                user.scanners = oldScanners;
                users[user.username] = user;
                scannerQueries.push(query('SELECT * from scanner WHERE scanner_user_id = ?', user.id).then(scanners => {
                    users[user.username].scanners = scanners;
                }));
            }
            await Promise.all(scannerQueries);
        } catch (error) {
            console.error('Error refreshing users', error);
        }
        emitter.emit('usersUpdated');
        usersUpdated = false;
    },
    userFlags,
    scannerFlags,
    validateUser: async (username, password) => {
        if (!username || !password) {
            return false;
        }
        const usrs = await scannerFramework.getUsers();
        const user = usrs[username];
        if (!user) {
            return false;
        }
        if (user.password !== password) {
            return false;
        }
        if (!user.flags) {
            return false;
        }
        return true;
    },
    on: (event, listener) => {
        return emitter.on(event, listener);
    },
    off: (event, listener) => {
        return emitter.off(event, listener);
    },
    once: (event, listener) => {
        return emitter.once(event, listener);
    },
};

scannerFramework.refreshUsers();

module.exports = scannerFramework;
