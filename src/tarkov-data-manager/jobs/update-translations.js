const fs = require('fs');
const path = require('path');

const ttData = require('../modules/tt-data');
const normalizeName = require('../modules/normalize-name');

const {connection} = require('../modules/db-connection');

const INSERT_KEYS = [
    'Name',
    'ShortName',
];

module.exports = async () => {
    const allTTItems = await ttData();
    const bsgData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bsg-data.json')));
    const allKeys = Object.keys(bsgData);
    const currentDestinations = [];

    for(const key in allTTItems){
        const newKeys = Object.keys(allTTItems[key]);
        currentDestinations.push(allTTItems[key].normalizedName);

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

            if(insertKey === 'Name'){
                const oldKey = normalizeName(allTTItems[item._id][insertKey.toLowerCase()]);
                const newKey = normalizeName(item._props[insertKey].toString().trim());

                if(oldKey !== newKey && validDestinations.includes(newKey)){
                    try {
                        await new Promise((resolve, reject) => {
                            connection.query(`INSERT INTO
                            redirects
                                (source, destination)
                            VALUES
                                (?, ?)`, [oldKey, newKey], (error) => {
                                    if (error) {
                                        console.log(error);
                                        reject(error);
                                    }

                                    resolve();
                                }
                            );
                        });
                    } catch (redirectInsertError){
                        console.error(redirectInsertError);
                    }
                }
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

    await new Promise((resolve, reject) => {
        connection.query(`SELECT source, destination FROM redirects`, (error, results) => {
                if (error) {
                    console.log(error);
                    reject(error);
                }

                const sources = [];
                const destinations = [];

                const redirects = results
                    .map(row => {
                        sources.push(row.source);
                        destinations.push(row.destination);

                        return [
                            `/item/${row.source}`,
                            `/item/${row.destination}`,
                        ];
                    })
                    .filter(Boolean);


                for(const source of sources){
                    if(!currentDestinations.includes(source)){
                        continue;
                    }

                    console.log(`${source} is not a valid source`);
                }

                for(const source of sources){
                    if(!destinations.includes(source)){
                        continue;
                    }

                    console.log(`${source} is both a source and a destination`);
                }

                fs.writeFileSync(path.join(__dirname, '..', 'public', 'data', 'redirects.json'), JSON.stringify(Object.fromEntries(redirects), null, 4));

                resolve();
            }
        );
    });
};