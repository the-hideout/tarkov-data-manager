import mysql from 'mysql2';

let pool;

let connectedCount = 0;
let acquiredConnections = 0;

let keepPoolConnectionAlive = false;

const createPool = () => {
    if (pool) {
        return;
    }
    pool = mysql.createPool({
        host     : process.env.DATABASE_HOST,
        user     : process.env.DB_USER,
        password : process.env.DB_PASS,
        database : process.env.DATABASE_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        ssl: {
            rejectUnauthorized: false // allow self-signed certs
        },
        timezone: 'Z', // database uses Zulu (utc) time
    });

    pool.on('acquire', function (connection) {
        //console.log('Connection %d acquired', connection.threadId);
        connectedCount++;
        acquiredConnections++;
        /*connection.timeout = setTimeout(() => {
            //console.log('Destroying %d', connection.threadId);
            connection.destroy();
            acquiredConnections--;
        }, 240000);*/
    });
    
    /*pool.on('connection', function (connection) {
        console.log('Connected', connection.threadId);
    });
    
    pool.on('enqueue', function () {
        console.log('Waiting for available connection slot');
    });*/
    
    pool.on('release', function (connection) {
        //clearTimeout(connection.timeout);
        //console.log('Connection %d released', connection.threadId);
        acquiredConnections--;
    });
};

const waitForConnections = () => {
    if (connectedCount >= 5) {
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const connectedInterval = setInterval(() => {
            if (connectedCount >= 5) {
                clearInterval(connectedInterval);
                resolve();
            }
        }, 1000);
    });
};

const dbConnection = {
    keepAlive: (keepConnectionAlive) => {
        if (typeof keepConnectionAlive !== 'boolean') {
            return keepPoolConnectionAlive;
        }
        keepPoolConnectionAlive = keepConnectionAlive;
    },
    end: () => {
        if (!pool) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            pool.end(error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    },
    query: async (sql, values, options = {}) => {
        if (!pool) {
            createPool();
        }
        if (typeof values === 'object' && !Array.isArray(values)) {
            options = values;
            values = undefined;
        }
        let abortListener;
        return new Promise((resolve, reject) => {
            abortListener = () => {
                reject(new Error('Query aborted'));
            };
            options?.signal?.addEventListener('abort', abortListener, { once: true });
            try {
                pool.query({sql, values, timeout: options?.timeout}, (error, results) => {
                    if (error) {
                        return reject(error);
                    }
                    resolve(results);
                });
            } catch (error) {
                reject(error);
            }
        }).finally(() => {
            options.signal?.removeEventListener('abort', abortListener);
        });
    },
    batchQuery: async (sql, values = [], batchCallback, options = {}) => {
        const batchSize = dbConnection.maxQueryRows;
        let offset = 0;
        const results = [];
        const queryStart = new Date();
        if (values && !Array.isArray(values)) {
            batchCallback = values;
            values = [];
        }
        if (!options && typeof batchCallback !== 'function') {
            options = batchCallback;
            batchCallback = undefined;
        }
        let timeout = options.timeout;
        while (true) {
            const batchValues = [...values, offset, batchSize];
            let batchTimeout;
            if (timeout) {
                batchTimeout = timeout - (new Date() - queryStart);
                if (batchTimeout <= 0) {
                    return Promise.reject(new Error('Query inactivity timeout'));
                }
            }
            if (options.signal?.aborted) {
                return Promise.reject(new Error('Query aborted'));
            }
            const batchResults = await dbConnection.query(`${sql} LIMIT ?, ?`, batchValues, {timeout: batchTimeout, signal: options.signal});
            batchResults.forEach(r => results.push(r));
            if (batchCallback) {
                batchCallback(batchResults, offset);
            }
            if (batchResults.length < batchSize) {
                break;
            }
            offset += batchSize;
        }
        return results;
    },
    jobComplete: async () => {
        if (keepPoolConnectionAlive) {
            return Promise.resolve();
        }
        if (!pool || pool._closed) {
            return Promise.resolve();
        }
        //await waitForConnections();
        return new Promise((resolve, reject) => {
            pool.end(error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    },
    maxQueryRows: 1000000,
    connectionsInUse: () => {
        return acquiredConnections;
    },
};

export const { jobComplete, maxQueryRows, format, connectionsInUse, query, batchQuery, end: endConnection, keepAlive } = dbConnection;

export default dbConnection;
