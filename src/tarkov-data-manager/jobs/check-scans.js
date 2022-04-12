const { query, jobComplete } = require('../modules/db-connection');
const webhook = require('../modules/webhook');
const JobLogger = require('../modules/job-logger');

const ignoreSources = [
    'DESKTOP-DA1IT79',
    'DanBox2018',
    'DESKTOP-RAZZ',
    'LAPTOP-RAZZ',
    'DESKTOP-BKCSP2S',
    'NUC-PC',
    'XETA',
    'Mats-HP',
    'tt'
];

module.exports = async () => {
    const logger = new JobLogger('check-scans');
    try {
        const results = await query('select max(timestamp) as timestamp, source from price_data group by source order by `timestamp` desc');
        for (const result of results) {
            if (ignoreSources.includes(result.source)) {
                logger.log(`Ignoring source: ${result.source}`);
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
            logger.log(`${result.source}: ${lastScanAge}s`);

            if (lastScanAge < 1800) {
                continue;
            } else if (lastScanAge < 14400 && result.source == 'tm') {
                //TM prices only update every 3 hours.
                continue;
            }            

            const messageData = {
                title: `Missing scans from ${encodeURIComponent(result.source)}`,
                message: `The last scanned price was ${lastScanAge} seconds ago`
            };

            logger.log('Sending alert');
            webhook.alert(messageData);
        }

        // Possibility to POST to a Discord webhook here with cron status details
    } catch (error) {
        logger.error(error);
    }
    await jobComplete();
    logger.end();
};