const mysql = require('mysql');

const connection = mysql.createConnection({
    host     : 'tarkov-tools-master-1.cluster-c1vhfeufwkpn.eu-west-1.rds.amazonaws.com',
    user     : 'desktop1',
    password : process.env.MYSQL_PASSWORD,
    database : 'tarkov_tools',
});

connection.connect();

module.exports = async () => {
    return new Promise((resolve, reject) => {
        connection.query('select max(timestamp) as timestamp, source from price_data group by source order by `timestamp` desc', (error, results) => {
            if(error){
                return reject(error);
            }

            return resolve(results);
        });
    });
};