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

const query = (sql) => {
    return new Promise((resolve, reject) => {
        pool.query(sql, (error, results) => {
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
    format: mysql.format
};
