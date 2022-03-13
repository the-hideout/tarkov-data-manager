const mysql = require('mysql2');

const connection = mysql.createPool({
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

connection.promiseQuery = async (sql) => {
    return new Promise((resolve, reject) => {
        connection.query(sql, (queryError, results) => {
            if(queryError){
                return reject(queryError);
            }
            return resolve(results);
        });
    });
};

module.exports = connection;
