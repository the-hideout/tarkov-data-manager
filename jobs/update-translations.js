const fs = require('fs');
const path = require('path');

const bsgData = require('../bsg-data.json');
const ttData = require('../modules/tt-data');
const normalizeName = require('../modules/normalize-name');

const connection = require('../modules/db-connection');

const INSERT_KEYS = [
    'Name',
    'ShortName',
];

const redirects = require('../../tarkov-tools/workers-site/redirects.json');

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

            if(insertKey === 'Name'){
                const oldKey = normalizeName(allTTItems[item._id][insertKey.toLowerCase()]);
                const newKey = normalizeName(item._props[insertKey].toString().trim());

                if(oldKey !== newKey){
                    redirects[`/item/${oldKey}`] = `/item/${newKey}`;
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

    fs.writeFileSync(path.join(__dirname, '..', 'redirects.json'), JSON.stringify(redirects, null, 4));
};