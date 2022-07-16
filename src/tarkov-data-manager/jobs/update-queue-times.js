const moment = require('moment');
const got = require('got');

const cloudflare = require('../modules/cloudflare');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const { alert } = require('../modules/webhook');
const jobOutput = require('../modules/job-output');

// Helper function which creates a fresh map array
const setupMapArray = (allMaps) => {
    // Create a dictionary of all in-game maps with their time set to zero and totalEntries set to 0
    var maps = {};
    for (const map of allMaps) {
        // add the map to the maps object and set the time to 0 - make sure it is lowercase
        maps[map.name.toLowerCase()] = {map_id: map.id, time: 0, totalEntries: 0 };
    }

    return maps;
}

// Cron job to update the cloudflare KV store with crowd-sourced queue times
module.exports = async () => {
    logger = new JobLogger('update-queue-times');
    try {
        // Get times to filter by
        const timestamps = [];
        timestamps.push(moment().subtract(1, 'hours').format('YYYY-MM-DD HH:mm:ss'));
        timestamps.push(moment().subtract(6, 'hours').format('YYYY-MM-DD HH:mm:ss'));
        timestamps.push(moment().subtract(12, 'hours').format('YYYY-MM-DD HH:mm:ss'));
        timestamps.push(moment().subtract(1, 'days').format('YYYY-MM-DD HH:mm:ss'));
        timestamps.push(moment().subtract(7, 'days').format('YYYY-MM-DD HH:mm:ss'));

        // Fetch all current maps
        const allMaps = await jobOutput('update-maps', './dumps/map_data.json', logger);

        const queueTimes = {};
        for (const timestamp of timestamps) {
            queueTimes[timestamp] = setupMapArray(allMaps);
        }

        // Query all queue times from the longest possible time window
        const queueTimeResults = await query(`
            SELECT
                *
            FROM
                queue_data
            WHERE
                timestamp > ?;
        `, [timestamps[timestamps.length-1]]);
        // Loop through the results and add the queue times to the maps object
        for (const row of queueTimeResults) {
            const map = row.map;
            const time = row.time;
            // const type = row.type; // this value is not currently uses - for future use with scav / pmc raid types
            // Loop through the timestamps array and see if the row makes the cut
            for (const timestamp of timestamps) {
                if (timestamp> row.time) continue;
                // Add queue time to the respective map and increment the totalEntries
                queueTimes[timestamp][map].time += time;
                queueTimes[timestamp][map].totalEntries++;
            }
        }

        // Calculate the average queue time for each map using the time value and the totalEntries value
        // Append the average queue time which is matched to the 'map' key to the queueData array
        const queueTimeData = [];
        for (const timestamp in queueTimes) {
            const maps = queueTimes[timestamp];
            for (const map in maps) {
                queueTimeData.push({
                    cutoff: moment(timestamp).fromNow(),
                    map_id: maps[map].map_id, 
                    time: maps[map].time / maps[map].totalEntries 
                });
            }
        }

        console.log(JSON.stringify(queueTimeData));

        // PUT the queueTimes data to the cloudflare KV store
        const queueData = {
            updated: new Date(),
            data: queueTimeData,
        };
        let response = await cloudflare.put('queue_data', JSON.stringify(queueData)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of queue_data');
        } else {
            for (const error of response.errors) {
                logger.error(error);
            }
            for (const warning of response.messages) {
                logger.error(warning);
            }
        }

    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    await jobComplete();
    logger.end();
    logger = false;
};
