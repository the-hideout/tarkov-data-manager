const mysql = require('mysql');

/*const connection = mysql.createConnection({
    host     : 'tarkov-tools-master-1.cluster-c1vhfeufwkpn.eu-west-1.rds.amazonaws.com',
    user     : process.env.MYSQL_USERNAME,
    password : process.env.MYSQL_PASSWORD,
    database : 'tarkov_tools',
});

connection.connect();*/

const connection = mysql.createPool({
    host     : 'tarkov-tools-master-1.cluster-c1vhfeufwkpn.eu-west-1.rds.amazonaws.com',
    user     : process.env.MYSQL_USERNAME,
    password : process.env.MYSQL_PASSWORD,
    database : 'tarkov_tools',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = connection;