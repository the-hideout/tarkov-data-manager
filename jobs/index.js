const schedule = require('node-schedule');

module.exports = () => {
    // Only run in production
    if(process.env.NODE_ENV !== 'production'){
        return true;
    }

    const checkScansJob = require('./check-scans');
    const checkScansJobSchedule = schedule.scheduleJob('20 * * * *', () => {
        console.log('Running check scans job');
        checkScansJob();
    });

    const updateCacheJob = require('./update-cache');
    const updateCacheJobSchedule = schedule.scheduleJob('* * * * *', () => {
        console.log('Running cache update job');
        updateCacheJob();
    });

    const clearCheckouts = require('./clear-checkouts');
    const clearCheckoutJobSchedule = schedule.scheduleJob('5 4 */6 * *', () => {
        console.log('Running clear checkouts job');
        clearCheckouts();
    });

    const updateBarters = require('./update-barters');
    const updateBartersJobSchedule = schedule.scheduleJob('5 14 * * *', () => {
        console.log('Running update barters job');
        updateBarters();
    });

};
