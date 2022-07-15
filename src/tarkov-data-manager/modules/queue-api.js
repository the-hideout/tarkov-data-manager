const { query } = require('./db-connection');

module.exports = {
    handle: async (req, res) => {
        console.log(req, res);
        res.json({status: "success"});
    }
};
