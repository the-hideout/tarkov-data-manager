// Cron job to update the cloudflare KV store with crowd-sourced queue times
import { DateTime } from 'luxon';

import DataJob from '../modules/data-job.mjs';

class UpdateQueueTimesJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-queue-times'});
        this.kvName = 'queue_data';
    }

    async run() {
        // Get times to filter by
        var timestamps = [];
        timestamps.push({ details: 'last 1 hour', timestamp: DateTime.now().minus({hours: 1}).toFormat('yyyy-LL-dd HH:mm:ss')});
        timestamps.push({ details: 'last 6 hours', timestamp: DateTime.now()().minus({hours: 6}).toFormat('yyyy-LL-dd HH:mm:ss')});
        timestamps.push({ details: 'last 12 hours', timestamp: DateTime.now()().minus({hours: 12}).toFormat('yyyy-LL-dd HH:mm:ss')});
        timestamps.push({ details: 'last 1 day', timestamp: DateTime.now()().minus({days: 1}).toFormat('yyyy-LL-dd HH:mm:ss')});
        timestamps.push({ details: 'last 7 days', timestamp: DateTime.now()().minus({days: 7}).toFormat('yyyy-LL-dd HH:mm:ss')});

        // Fetch all current maps
        const allMaps = await this.jobManager.jobOutput('update-maps', this);

        const queueTimes = {};
        for (const timestamp of timestamps) {
            var maps = setupMapArray(allMaps.body.data.maps)

            // Query the database for records with the given timestamp
            const result = await queueQuery(timestamp.timestamp);

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
                queueData.push({ map: map, time: Math.round(maps[map].time / maps[map].totalEntries) });
            }

            // Add the results to the queueTimes object
            queueTimes[timestamp.details] = {queueData: queueData, timestamp: timestamp.timestamp};
        }

        // Query all queue times from the longest possible time window
        const queueTimeResults = await this.query(`
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
                    cutoff: DateTime.fromJSDate(timestamp).toRelative(),
                    map_id: maps[map].map_id, 
                    time: maps[map].time / maps[map].totalEntries 
                });
            }
        }

        //console.log(JSON.stringify(queueTimeData));

        // PUT the queueTimes data to the cloudflare KV store
        const kvData = {
            updated: new Date(),
            data: queueTimeData,
        };
        await this.cloudflarePut(kvData);
        return kvData;
    }
}

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

export default UpdateQueueTimesJob;
