const {connection} = require('./db-connection');

module.exports = async function doQuery(query, params) {
    let responseData;
    const promise = new Promise((resolve, reject) => {
        connection.query(query,
            params
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

    return responseData;
};