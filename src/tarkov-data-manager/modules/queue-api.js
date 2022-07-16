const { query, format } = require('./db-connection');

// Helper function to validate the request body
// :param req: the request object
// :param res: the response object
// :return: an object containing the 'map', 'time', and 'type' fields - false if the request is invalid
const validation = async (req, res) => {
    try {
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

        return { map: map, time: time, type: type };
    } catch {
        res.status(400).send('validation on your request body failed')
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
        } catch {
            res.json({ status: "failure" });
            return;
        }
    }
};
