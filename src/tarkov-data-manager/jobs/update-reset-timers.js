const DataJob = require('../modules/data-job');

class UpdateResetTimersJob extends DataJob {
    constructor() {
        super('update-reset-timers');
        this.kvName = 'reset_time_data';
    }

    async run() {
        const traders = await this.jobManager.jobOutput('update-traders', this);

        const resetTimes = {};
        for (const trader of traders) {
            const date = new Date(trader.nextResupply*1000);
            date.setHours(date.getHours() +5);
            resetTimes[trader.normalizedName] = date;
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

        await this.cloudflarePut(resetTimes);

        // fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'reset-times.json'), JSON.stringify(cloudflareData, null, 4));

        // Possibility to POST to a Discord webhook here with cron status details
        return resetTimes;
    }
}

module.exports = UpdateResetTimersJob;
