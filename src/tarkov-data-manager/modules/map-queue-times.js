const { query, jobComplete } = require('./db-connection.mjs');
const JobLogger = require('../modules/job-logger');
const { alert } = require('../modules/webhook');
const {jobOutput} = require('../jobs/index.mjs');

// function to get map queue times
module.exports = async (allMaps, logger = false) => {
    let closeLogger = false;
    if (!logger) {
        logger = new JobLogger('update-queue-times');
        closeLogger = true;
    }
    try {
        // Get times to filter by
        const timestamps = [];
        timestamps.push(new Date() - 1000 * 60 * 60); // one hour
        timestamps.push(new Date() - 1000 * 60 * 60 * 6); // six hours
        timestamps.push(new Date() - 1000 * 60 * 60 * 12); // twelve hours
        timestamps.push(new Date() - 1000 * 60 * 60 * 24); // one day
        timestamps.push(new Date() - 1000 * 60 * 60 * 24 * 7); // seven days
console.log(timestamps.map(ts => new Date(ts)));
        // Fetch all current maps if needed
        if (!allMaps) allMaps = await jobOutput('update-maps', logger);

        const queueTimes = {};
        for (const map of allMaps) {
            queueTimes[map.name.toLowerCase()] = {
                id: map.id,
                times: {}
            };
            for (const timestamp of timestamps) {
                queueTimes[map.name.toLowerCase()].times[timestamp] = { time: 0, count: 0 };
            }
        }

        // Query all queue times from the longest possible time window
        const queueTimeResults = await query(`
            SELECT
                *
            FROM
                queue_data
            WHERE
                timestamp > ?;
        `, [new Date(timestamps[timestamps.length-1]).toISOString().slice(0, 19).replace('T', ' ')]);

        // Loop through the results and add the queue times to the maps object
        for (const row of queueTimeResults) {
            const map = row.map;
            const time = row.time;
            if (!queueTimes[map]) {
                logger.log(`map ${map} from queue time not recognized as valid map`); continue;
            }
            // const type = row.type; // this value is not currently uses - for future use with scav / pmc raid types
            // Loop through the timestamps array and see if the row makes the cut
            for (const timestamp of timestamps) {
                if (row.timestamp < new Date(timestamp)) {
                    console.log(`rejecting ${map} ${row.timestamp} for cutoff ${new Date(timestamp)}`)
                    continue;
                }
                //console.log(`${row.timestamp}\n${new Date(timestamp)}\n`);
                // Add queue time to the respective map and increment the count
                queueTimes[map].times[timestamp].time += time;
                queueTimes[map].times[timestamp].count++;
            }
        }
//console.log(JSON.stringify(queueTimes, null, 4));
        // Calculate the average queue time for each map using the time value and the count value
        // Append the average queue time which is matched to the 'map' key to the queueData array
        const queueTimeData = {};
        for (const mapName in queueTimes) {
            const mapId = queueTimes[mapName].id;
            queueTimeData[mapId] = [];
            for (const timestamp in queueTimes[mapName].times) {
                queueTimeData[mapId].push({
                    dateCutoff: new Date(parseInt(timestamp)),
                    avgQueueTime: Math.round(queueTimes[mapName].times[timestamp].time / queueTimes[mapName].times[timestamp].count) 
                });
            }
        }

        console.log(JSON.stringify(queueTimeData, null, 4));

        await jobComplete()
        if (closeLogger) {
            logger.end();
            logger = false;
        }

        return queueTimeData;
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
        await jobComplete()
        if (closeLogger) {
            logger.end();
            logger = false;
        }
    }
};
