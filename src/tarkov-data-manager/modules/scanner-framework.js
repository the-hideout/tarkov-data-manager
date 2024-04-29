const { query } = require('./db-connection');

const emitter = new EventEmitter();

const users = {};

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

const refreshUsers = async () => {
    const results = await query('SELECT * from scanner_user WHERE disabled=0');
    const scannerQueries = [];
    
    for (const username in users) {
        const newestUser = results.find(r => r.username === username);
        if (!newestUser) {
            users[username] = undefined;
            emitter.emit('userDeleted', username);
            continue;
        }
        if (users[username].flags && !newestUser.flags) {
            emitter.emit('userDisabled', username);
        }
    }
    for (const user of results) {
        const oldScanners = users[user.username]?.scanners;
        user.scanners = oldScanners;
        users[user.username] = user;
        scannerQueries.push(query('SELECT * from scanner WHERE scanner_user_id = ?', user.id).then(scanners => {
            users[user.username].scanners = scanners;
        }));
    }
    await Promise.all(scannerQueries);
};

refreshUsers();

const scannerFramework = {
    users,
    refreshUsers,
    userFlags,
    scannerFlags,
    validateUser: (username, password) => {
        if (!username || !password) {
            return false;
        }
        if (!users[username]) {
            return false;
        }
        if (users[username].password !== password) {
            return false;
        }
        if (!users[username].flags) {
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

module.exports = scannerFramework;
