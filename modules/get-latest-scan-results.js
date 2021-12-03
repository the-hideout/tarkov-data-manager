const connection = require('./db-connection');

module.exports = async () => {
    return new Promise((resolve, reject) => {
        console.time('latest-scan-query');
        connection.query('select max(timestamp) as timestamp, source from price_data where timestamp > DATE_SUB(CURDATE(), INTERVAL 7 DAY) group by source order by `timestamp` desc', (error, results) => {
            if(error){
                return reject(error);
            }

            console.timeEnd('latest-scan-query');

            return resolve(results);
        });
    });
};