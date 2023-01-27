const mysql = require('mysql2');

const pool = mysql.createPool({
    host     : process.env.DATABASE_HOST,
    user     : process.env.PSCALE_USER,
    password : process.env.PSCALE_PASS,
    database : process.env.DATABASE_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        rejectUnauthorized: true
    }
});

let connectedCount = 0;

pool.on('acquire', function (connection) {
    //console.log('Connection %d acquired', connection.threadId);
    connectedCount++;
});

/*pool.on('connection', function (connection) {
    console.log('Connected', connection.threadId);
});

pool.on('enqueue', function () {
    console.log('Waiting for available connection slot');
});

pool.on('release', function (connection) {
    console.log('Connection %d released', connection.threadId);
});*/

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

const query = (sql, params) => {
    return new Promise((resolve, reject) => {
        pool.query(sql, params, (error, results) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(results);
        });
    });
};

module.exports = {
    connection: pool,
    pool: pool,
    query: query,
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
    }
};
