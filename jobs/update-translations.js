const mysql = require('mysql');
const bsgData = require('../bsg-data.json');
const ttData = require('../modules/tt-data');

const connection = mysql.createConnection({
    host     : 'tarkov-tools-master-1.cluster-c1vhfeufwkpn.eu-west-1.rds.amazonaws.com',
    user     : 'desktop1',
    password : process.env.MYSQL_PASSWORD,
    database : 'tarkov_tools',
});

connection.connect();

const INSERT_KEYS = [
    'Name',
    'ShortName',
    // 'Description',
];

module.exports = async () => {
    const allTTItems = await ttData();
    const allKeys = Object.keys(bsgData);

    for(const key in allTTItems){
        const newKeys = Object.keys(allTTItems[key]);

        for(const newKey of newKeys){
            allTTItems[key][newKey.toLowerCase()] = allTTItems[key][newKey];
        }
    }

    for(let i = 0; i < allKeys.length; i = i + 1){
        const item = bsgData[allKeys[i]];
        if(!item._props){
            continue;
        }

        if(!allTTItems[item._id]){
            continue;
        }

        console.log(`Updating ${i + 1}/${allKeys.length} ${item._id} ${item._props.ShortName}`);
        for(const insertKey of INSERT_KEYS){
            if(!item._props[insertKey]){
                console.log(`Item ${item._id} is missing ${insertKey}`);
                continue;
            }

            if(item._props[insertKey].toString().trim() === allTTItems[item._id][insertKey.toLowerCase()]){
                continue;
            }

            console.log(`New ${insertKey} for ${item._id}`);
            console.log(`OLD: ${allTTItems[item._id][insertKey.toLowerCase()]}`);
            console.log(`NEW: ${item._props[insertKey].toString().trim()}`);

            await new Promise((translationResolve, translationReject) => {
                connection.query(`UPDATE
                    translations
                SET
                    value = ?
                WHERE
                    item_id = ?
                AND
                    language_code = ?
                AND
                    type = ?`, [item._props[insertKey].toString().trim(), item._id, 'en', insertKey.toLowerCase()], (error) => {
                        if (error) {
                            console.log(error);
                            translationReject(error);
                        }

                        translationResolve();
                    }
                );
            });
        }
    }

    connection.end();
};