const moment = require('moment');
const cloudflare = require('../modules/cloudflare');
const { query, jobComplete } = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const { alert } = require('../modules/webhook');
const got = require('got');

// Helper function to query the database and return records for a given timestamp
const queueQuery = async (time) => {
    const result = await query(`
            SELECT
                *
            FROM
                queue_data
            WHERE
                timestamp > ?;
        `, [time]);

    return result;
}

// Helper function which creates a fresh map array
const setupMapArray = async (allMaps) => {
    // Create a dictionary of all in-game maps with their time set to zero and totalEntries set to 0
    var maps = {};
    for (const map of allMaps) {
        // if the map contains the word 'night', skip it
        if (map.name.toLowerCase().includes('night')) {
            continue;
        }

        // add the map to the maps object and set the time to 0 - make sure it is lowercase
        maps[map.name.toLowerCase()] = { time: 0, totalEntries: 0 };
    }

    return maps;
}

// Cron job to update the cloudflare KV store with crowd-sourced queue times
module.exports = async () => {
    logger = new JobLogger('update-queue-times');
    try {
        // Get times to filter by
        var timestamps = [];
        timestamps.push(moment().subtract(1, 'hours').format('YYYY-MM-DD HH:mm:ss'));
        timestamps.push(moment().subtract(6, 'hours').format('YYYY-MM-DD HH:mm:ss'));
        timestamps.push(moment().subtract(12, 'hours').format('YYYY-MM-DD HH:mm:ss'));
        timestamps.push(moment().subtract(1, 'days').format('YYYY-MM-DD HH:mm:ss'));
        timestamps.push(moment().subtract(7, 'days').format('YYYY-MM-DD HH:mm:ss'));

        // Fetch all current maps from the API
        const allMaps = await got('https://api.tarkov.dev/graphql?query={maps{name}}', {
            responseType: 'json',
        });

        // Loop through the timestamps array and make a SQL query with each one
        var queueTimes = {};
        for (const timestamp of timestamps) {
            var maps = await setupMapArray(allMaps.body.data.maps)

            // Query the database for records with the given timestamp
            const result = await queueQuery(timestamp);

            // Loop through the results and add the queue times to the maps object
            for (const row of result) {
                const map = row.map;
                const time = row.time;
                // const type = row.type; // this value is not currently uses - for future use with scav / pmc raid types

                // Add queue time to the respective map and increment the totalEntries
                maps[map].time += time;
                maps[map].totalEntries++;
            }

            // Calculate the average queue time for each map using the time value and the totalEntries value
            // Append the average queue time which is matched to the 'map' key to the queueData array
            var queueData = [];
            for (const map in maps) {
                queueData.push({ map: map, time: maps[map].time / maps[map].totalEntries });
            }

            // Add the results to the queueTimes object
            queueTimes[timestamp] = queueData;
        }

        console.log(JSON.stringify(queueTimes));

        // await cloudflare.set(`queue_times_${map}_${type}`, time);

    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
        logger.end();
        jobComplete();
        logger = false;
    }
};
