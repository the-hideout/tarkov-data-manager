const {jobComplete} = require('../modules/db-connection');
const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');

module.exports = async () => {
    const logger = new JobLogger('update-reset-timers');
    try {
        const traders = await tarkovChanges.traders();
        const en = await tarkovChanges.locale_en();

        const resetTimes = {};
        for (const id in traders) {
            const trader = traders[id];
            const date = new Date(trader.nextResupply*1000);
            date.setHours(date.getHours() +5);
            resetTimes[en.trading[id].Nickname.toLowerCase()] = date;
        }
        /*const resetTimes = {};
        const results = await query(`
            SELECT
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
                trader.trader_name = max_time.trader_name;
        `);
        for(const result of results){
            const [hours, minutes, seconds] = result.reset_time.split(':').map(Number);
            const resetTime = result.created;

            resetTime.setHours(resetTime.getHours() + hours);
            resetTime.setMinutes(resetTime.getMinutes() + minutes);
            resetTime.setSeconds(resetTime.getSeconds() + seconds);

            resetTimes[result.trader_name] = resetTime;
        }*/

        const response = await cloudflare('reset_time_data', 'PUT', JSON.stringify(resetTimes)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of reset_time_data');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                logger.error(response.messages[i]);
            }
        }

        // fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'reset-times.json'), JSON.stringify(cloudflareData, null, 4));

        // Possibility to POST to a Discord webhook here with cron status details
    } catch (error){
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
    await jobComplete();
};