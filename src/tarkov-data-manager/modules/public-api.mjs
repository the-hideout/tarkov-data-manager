import { DateTime } from 'luxon';

import { jobOutput } from '../jobs/index.mjs';
import dbConnection from './db-connection.mjs';
import { alert } from './webhook.mjs';

const allMaps = { timestamp: DateTime.now().toFormat('yyyy-LL-dd HH:mm:ss'), maps: [] };

const raidTypes = ['scav', 'pmc', 'pve', 'unknown'];

const validateMap = async (req, res) => {
    // Check if allMaps has data and is from the last 1 hour cache time
    if (allMaps.timestamp > DateTime.now().minus({minutes: 15}).toFormat('yyyy-LL-dd HH:mm:ss') && allMaps.maps.length > 0) {
        // console.log('public-api: using cached map data');
    } else {
        // Fetch all current maps
        const allMapsRaw = await jobOutput('update-maps');

        // Update the allMaps object in the memory cache
        allMaps.timestamp = DateTime.now().toFormat('yyyy-LL-dd HH:mm:ss');
        allMaps.maps = allMapsRaw;
        // console.log('public-api: using fresh map data');
    }

    // Do some basic validation
    let map;
    if (req.body.map === undefined || req.body.map === null || req.body.map === '') {
        res.status(400).send("value 'map' is required");
        return false;
    } else {
        map = req.body.map;
        // If the map is not valid, return an error
        if (!allMaps.maps.some(mapItem => mapItem.nameId === map)) {
            res.status(400).send(`value 'map' must be one of: ${allMaps.maps.map(map => map.nameId).join(', ')}`);
            return false;
        }
    }
    return map;
};

// Helper function to validate the request body
// :param req: the request object
// :param res: the response object
// :return: an object containing the 'map', 'time', and 'type' fields - false if the request is invalid
const validateQueue = async (req, res) => {
    try {
        const map = await validateMap(req, res);
        if (!map) {
            return false;
        }

        let time;
        if (req.body.time === undefined || req.body.time === null || req.body.time === '') {
            res.status(400).send("value 'time' is required");
            return false;
        } else {
            time = parseInt(req.body.time);
        }

        let type;
        if (req.body.type === undefined || req.body.type === null || req.body.type === '') {
            type = 'unknown';
        } else {
            type = req.body.type;
            // If the raid type is not valid, return an error
            if (!raidTypes.includes(type)) {
                res.status(400).send(`value 'type' must be one of: ${raidTypes.join(', ')}`);
                return false;
            }
        }

        return { map: map, time: time, type: type, gameMode: req.body.gameMode };
    } catch (error) {
        alert({
            title: `Error during public-api queue validation`,
            message: error.toString(),
        });
        res.status(500).send('validation on your request body failed')
        return false;
    }
};

const validateGoons = async (req, res) => {
    try {
        const map = await validateMap(req, res);
        if (!map) {
            return false;
        }

        let timestamp;
        if (req.body.timestamp === undefined || req.body.timestamp === null || req.body.timestamp === '') {
            res.status(400).send("value 'timestamp' is required");
            return false;
        } else {
            timestamp = new Date(req.body.timestamp);
        }

        let accountId, discordId;

        if (req.body.accountId) {
            accountId = req.body.accountId
        }
        if (req.body.discordId) {
            discordId = req.body.discordId;
        }
        if (!accountId && !discordId) {
            res.status(400).send("value 'accountId' or 'discordId' is required");
            return false;
        }

        return { map, timestamp, accountId, discordId, gameMode: req.body.gameMode };
    } catch (error) {
        alert({
            title: `Error during public-api goons validation`,
            message: error.toString(),
        });
        res.status(500).send('validation on your request body failed')
        return false;
    }
};

const publicApi = {
    queue: async (req, res) => {
        // Validate the request body
        const data = await validateQueue(req, res);

        // If validation failed, return
        if (data === false) {
            return;
        }

        try {
            // Insert the data into the database
            await dbConnection.query(`INSERT INTO queue_data (map, time, type) VALUES (?, ?, ?)`, [data.map, data.time, data.type]);
            res.json({ status: 'success' });
            return;
        } catch (error) {
            alert({
                title: `Error during queue-api insert`,
                message: error.toString(),
            });
            res.status(500).json({status: 'failure'});
            return;
        }
    },
    goons: async (req, res) => {
        // Validate the request body
        const data = await validateGoons(req, res);

        // If validation failed, return
        if (data === false) {
            return;
        }

        try {
            const ipAddress = req.headers['cf-connecting-ip'] || req.ip;
            let report_id_field = 'account_id';
            let report_id_value;
            if (data.accountId) {
                report_id_field = 'account_id';
                report_id_value = data.accountId;
            } else if (data.discordId) {
                report_id_field = 'discord_id';
                report_id_value = String(data.discordId);
            }

            // Insert the data into the database
            await dbConnection.query(`INSERT INTO goon_reports (map, game_mode, timestamp, ${report_id_field}, reporter_ip) VALUES (?, ?, ?, ?, ?)`, [data.map, data.gameMode, data.timestamp, report_id_value, ipAddress]);
            res.json({ status: 'success' });
            return;
        } catch (error) {
            alert({
                title: `Error during public-api goons insert`,
                message: error.toString(),
            });
            res.status(500).json({status: 'failure'});
            return;
        }
    },
};

export default publicApi;
