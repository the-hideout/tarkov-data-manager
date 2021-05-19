require('dotenv').config();

const mysql = require('mysql');
const got = require('got');

const ignoreSources = [
    'DESKTOP-BKCSP2S',
    'DESKTOP-DA1IT79',
    'DanBox2018',
    'DESKTOP-RAZZ',
];

const connection = mysql.createConnection({
    host     : 'tarkov-tools-master-1.cluster-c1vhfeufwkpn.eu-west-1.rds.amazonaws.com',
    user     : 'desktop1',
    password : process.env.MYSQL_PASSWORD,
    database : 'tarkov_tools',
});

connection.connect();

module.exports = async () => {
    console.log('Running last scan check');
    connection.query('select max(timestamp) as timestamp, source from price_data group by source order by `timestamp` desc', (queryError, results) => {
        for(const result of results){
            if(ignoreSources.includes(result.source)){
                continue;
            }

            console.log(JSON.stringify(result));
            // Db timestamps are off so we add an hour
            const lastScan = new Date(result.timestamp.setTime(result.timestamp.getTime() + 3600000));

            // console.log(lastScan);
            // console.log(new Date());

            // console.log(lastScan.getTimezoneOffset());
            // console.log(new Date().getTimezoneOffset());

            const lastScanAge = Math.floor((new Date().getTime() - lastScan.getTime()) / 1000)
            console.log(`${result.source}: ${lastScanAge}s`);

            if(lastScanAge < 1800){
                continue;
            }

            const messageData = {
                title: `Missing scans from ${encodeURIComponent(result.source)}`,
                message: `The last scanned price was ${lastScanAge} seconds ago`,
                users: 'QBfmptGTgQoOS2gGOobd5Olfp31hTKrG',
            };

            got.post(`https://notifyy-mcnotifyface.herokuapp.com/out`, {
                json: messageData,
            });
        }

        connection.end();
    });
};