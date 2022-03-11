const mysql = require('mysql2');

/*const connection = mysql.createConnection({
    host     : 'tarkov-tools-master-1.cluster-c1vhfeufwkpn.eu-west-1.rds.amazonaws.com',
    user     : process.env.MYSQL_USERNAME,
    password : process.env.MYSQL_PASSWORD,
    database : 'tarkov_tools',
});

connection.connect();*/

const connection = mysql.createPool({
    host     : '6hvetf6kcr04.us-east-1.psdb.cloud',
    user     : process.env.MYSQL_USERNAME,
    password : process.env.MYSQL_PASSWORD,
    database : 'tarkov',
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