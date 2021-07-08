const mysql = require('mysql');

module.exports = async function doQuery(query) {
    const connection = mysql.createConnection({
        host     : 'tarkov-tools-master-1.cluster-c1vhfeufwkpn.eu-west-1.rds.amazonaws.com',
        user     : 'desktop1',
        password : process.env.MYSQL_PASSWORD,
        database : 'tarkov_tools',
    });

    connection.connect();

    let responseData;
    const promise = new Promise((resolve, reject) => {
        connection.query(query
            , async (error, results) => {
                if (error) {
                    reject(error)
                }

                resolve(results);
            }
        );
    });

    try {
        responseData = await promise;
    } catch (upsertError){
        console.error(upsertError);

        throw upsertError;
    }

    connection.end();

    return responseData;
};