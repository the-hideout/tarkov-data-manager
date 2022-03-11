const connection = require('../modules/db-connection');
const cloudflare = require('../modules/cloudflare');

module.exports = async () => {
    const resetTimes = {};
    const promise = new Promise((resolve, reject) => {
        connection.query(`SELECT
        trader.trader_name,
        trader.reset_time,
        trader.created
    FROM
        trader_reset AS trader
    INNER JOIN (
      SELECT id, trader_name, MAX(created) AS timestamp
      FROM trader_reset
      GROUP BY trader_name, id, created
    ) AS max_time
    ON
        trader.created = max_time.timestamp
    AND
        trader.trader_name = max_time.trader_name;`, async (error, results) => {
                if (error) {
                    reject(error)
                }

                for(const result of results){
                    const [hours, minutes, seconds] = result.reset_time.split(':').map(Number);
                    const resetTime = result.created;

                    resetTime.setHours(resetTime.getHours() + hours);
                    resetTime.setMinutes(resetTime.getMinutes() + minutes);
                    resetTime.setSeconds(resetTime.getSeconds() + seconds);

                    resetTimes[result.trader_name] = resetTime;
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

    try {
        const response = await cloudflare(`/values/RESET_TIMES`, 'PUT', JSON.stringify(resetTimes));
        console.log(response);
    } catch (requestError){
        console.error(requestError);
    }

    // fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'reset-times.json'), JSON.stringify(cloudflareData, null, 4));
};