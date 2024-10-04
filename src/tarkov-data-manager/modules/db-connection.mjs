import mysql from 'mysql2';

const pool = mysql.createPool({
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

let connectedCount = 0;
let acquiredConnections = 0;

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
    connection: pool,
    pool,
    query: (sql, params) => {
        return new Promise((resolve, reject) => {
            try {
                pool.query(sql, params, (error, results) => {
                    if (error) {
                        reject(error);
                        return;
                    }
        
                    resolve(results);
                });
            } catch (error) {
                reject(error);
            }
        });
    },
    batchQuery: async (sql, params = [], batchCallback) => {
        const batchSize = dbConnection.maxQueryRows;
        let offset = 0;
        const results = [];
        while (true) {
            const batchParams = [...params, offset, batchSize]
            const batchResults = await dbConnection.query(`${sql} LIMIT ?, ?
            `, batchParams);
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
    format: mysql.format,
    jobComplete: async () => {
        if (pool.keepAlive) {
            return Promise.resolve(false);
        }
        await waitForConnections();
        return new Promise((resolve, reject) => {
            pool.end(error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(true);
            });
        });
    },
    maxQueryRows: 1000000,
    connectionsInUse: () => {
        return acquiredConnections;
    },
};

export const { connection, jobComplete, maxQueryRows, format, connectionsInUse, query, batchQuery } = dbConnection;

export default dbConnection;
