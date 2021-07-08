const mysql = require('mysql');

const connection = mysql.createConnection({
    host     : 'tarkov-tools-master-1.cluster-c1vhfeufwkpn.eu-west-1.rds.amazonaws.com',
    user     : 'desktop1',
    password : process.env.MYSQL_PASSWORD,
    database : 'tarkov_tools',
});

connection.connect();

module.exports = async () => {
    const promise = new Promise((resolve, reject) => {
        connection.query(`SELECT
            MAX(timestamp) AS last_scan,
            source
        FROM
            price_data
        GROUP BY
        source;`
            , async (error, results) => {
                if (error) {
                    reject(error)
                }

                const now = new Date();
                const scanCutoff = (now.getTime() / 1000) - 21600 - (now.getTimezoneOffset() * 60);

                for(const scannerResult of results){
                    if((scannerResult.last_scan.getTime() / 1000) > scanCutoff){
                        continue;
                    }
                    console.log(`${scannerResult.source} hasn't worked since ${scannerResult.last_scan} so removing the checkout`);

                    await new Promise((checkoutResolve, checkoutReject) => {
                        connection.query(`UPDATE
                            item_data
                        SET
                            checked_out_by = NULL
                        WHERE
                            checked_out_by = ?;`, [scannerResult.source], (error, results) => {
                                if(error){
                                    return checkoutReject(error);
                                }

                                checkoutResolve();
                            })
                    });
                }

                resolve();
            }
        );
    });

    try {
        await promise;
    } catch (upsertError){
        console.error(upsertError);
        connection.end();

        throw upsertError;
    }

    connection.end();
};