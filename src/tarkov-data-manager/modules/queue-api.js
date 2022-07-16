const { query, format } = require('./db-connection');
const { alert } = require('./webhook');
const got = require('got');
const moment = require('moment');

var allMaps = { timestamp: moment().format('YYYY-MM-DD HH:mm:ss'), maps: [] };

// Helper function to validate the request body
// :param req: the request object
// :param res: the response object
// :return: an object containing the 'map', 'time', and 'type' fields - false if the request is invalid
const validation = async (req, res) => {
    try {
        // Check if allMaps has data and is from the last 1 hour cache time
        if (allMaps.timestamp > moment().subtract(1, 'hours').format('YYYY-MM-DD HH:mm:ss') && allMaps.maps.length > 0) {
            // console.log('queue-api: using cached map data');
        } else {
            // Fetch all current maps from the API
            const allMapsRaw = await got('https://api.tarkov.dev/graphql?query={maps{name}}', {
                responseType: 'json',
            });

            // Update the allMaps object in the memory cache
            allMaps['timestamp'] = moment().format('YYYY-MM-DD HH:mm:ss');
            allMaps['maps'] = allMapsRaw.body.data.maps;
            // console.log('queue-api: using fresh map data');
        }

        // Do some basic validation
        var map;
        if (req.body.map === undefined || req.body.map === null || req.body.map === '') {
            res.status(400).send("value 'map' is required");
            return false;
        } else {
            map = req.body.map;
        }
        var time;
        if (req.body.time === undefined || req.body.time === null || req.body.time === '') {
            res.status(400).send("value 'time' is required");
            return false;
        } else {
            time = parseInt(req.body.time);
        }
        var type;
        if (req.body.type === undefined || req.body.type === null || req.body.type === '') {
            type = 'unknown';
        } else {
            type = req.body.type;
        }

        // Check if the map is valid
        var validMapName = false;
        for (const mapItem of allMaps.maps) {
            // If the submitted map name is valid, exit
            if (mapItem.name.toLowerCase() === map.toLowerCase()) {
                validMapName = true;
                break;
            }
        }
        // If the map is not valid, return an error
        if (!validMapName) {
            res.status(400).send(`value 'map' must be one of: ${allMaps.maps.map(map => map.name.toLowerCase()).join(', ')}`);
            return false;
        }

        return { map: map, time: time, type: type };
    } catch (error) {
        alert({
            title: `Error during queue-api validation`,
            message: error.toString()
        });
        res.status(500).send('validation on your request body failed')
        return false;
    }
}

module.exports = {
    handle: async (req, res) => {

        // Validate the request body
        const data = await validation(req, res);

        // If validation failed, return
        if (data === false) {
            return;
        }

        try {
            // Insert the data into the database
            await query(format(`INSERT INTO queue_data (map, time, type) VALUES (?, ?, ?)`, [data.map, data.time, data.type]));
            res.json({ status: "success" });
            return;
        } catch (error) {
            alert({
                title: `Error during queue-api execution`,
                message: error.toString()
            });
            res.status(500).send('failure');
            return;
        }
    }
};
