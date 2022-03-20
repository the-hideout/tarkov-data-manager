const {connection} = require('../modules/db-connection');

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

        throw upsertError;
    }
};