const {connection} = require('./db-connection');
const timer = require('./console-timer');

module.exports = async () => {
    return new Promise((resolve, reject) => {
        const t = timer('latest-scan-query');
        connection.query('select max(timestamp) as timestamp, source from price_data group by source order by `timestamp` desc', (error, results) => {
            if(error){
                return reject(error);
            }

            t.end();

            return resolve(results);
        });
    });
};