const { query, jobComplete } = require('../modules/db-connection');
const webhook = require('../modules/webhook');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

const ignoreSources = [
    'DESKTOP-DA1IT79',
    'DanBox2018',
    'DESKTOP-RAZZ',
    'LAPTOP-RAZZ',
    'DESKTOP-BKCSP2S',
    'NUC-PC',
    'XETA',
    'Mats-HP',
    'TARKOV-TOOLS-PULL'
];

module.exports = async () => {
    const logger = new JobLogger('check-scans');
    try {
        const results = await query(`
            select max(timestamp) as timestamp, scanner_id, name, username 
            from price_data 
            left join scanner on scanner.id = price_data.scanner_id
            left join scanner_user on scanner_user.id = scanner.scanner_user_id
            group by scanner_id 
            order by \`timestamp\` desc
        `);
        for (const result of results) {
            if (ignoreSources.includes(result.name)) {
                logger.log(`Ignoring source: ${result.name}`);
                continue;
            }

            logger.log(JSON.stringify(result));
            // Db timestamps are off so we add an hour
            const lastScan = new Date(result.timestamp.setTime(result.timestamp.getTime() + 3600000));

            // console.log(lastScan);
            // console.log(new Date());

            // console.log(lastScan.getTimezoneOffset());
            // console.log(new Date().getTimezoneOffset());

            const lastScanAge = Math.floor((new Date().getTime() - lastScan.getTime()) / 1000);
            logger.log(`${result.name}: ${lastScanAge}s`);

            if (lastScanAge < 1800) {
                continue;
            }           

            const messageData = {
                title: `Missing scans from ${encodeURIComponent(result.name)} (${result.username})`,
                message: `The last scanned price was ${lastScanAge} seconds ago`
            };

            logger.log('Sending alert');
            webhook.alert(messageData);
        }

        // Possibility to POST to a Discord webhook here with cron status details
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    await jobComplete();
    logger.end();
};