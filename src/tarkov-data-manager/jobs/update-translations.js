const fs = require('fs');
const path = require('path');

const ttData = require('../modules/tt-data');
const normalizeName = require('../modules/normalize-name');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

const {query, jobComplete} = require('../modules/db-connection');

const INSERT_KEYS = [
    'Name',
    'ShortName',
];

module.exports = async (externalLogger) => {
    const logger = externalLogger || new JobLogger('update-translations');
    try {
        const allTTItems = await ttData();
        const bsgData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bsg-data.json')));
        const allKeys = Object.keys(bsgData);
        const currentDestinations = [];

        logger.log(`Updating translations`);
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

            //logger.log(`Updating ${i + 1}/${allKeys.length} ${item._id} ${item._props.ShortName}`);
            for(const insertKey of INSERT_KEYS){
                if(!item._props[insertKey]){
                    logger.warn(`Item ${item._id} is missing ${insertKey}`);
                    continue;
                }

                if(item._props[insertKey].toString().trim() === allTTItems[item._id][insertKey.toLowerCase()]){
                    continue;
                }

                if(insertKey === 'Name'){
                    const oldKey = normalizeName(allTTItems[item._id][insertKey.toLowerCase()]);
                    const newKey = normalizeName(item._props[insertKey].toString().trim());

                    if(oldKey !== newKey && currentDestinations.includes(newKey)){
                        try {
                            await query(`
                                INSERT INTO
                                    redirects (source, destination)
                                VALUES
                                    (?, ?)
                            `, [oldKey, newKey]);
                        } catch (redirectInsertError){
                            logger.error(redirectInsertError);
                        }
                    }
                }

                logger.log(`New ${insertKey} for ${item._id}`);
                logger.log(`OLD: ${allTTItems[item._id][insertKey.toLowerCase()]}`);
                logger.log(`NEW: ${item._props[insertKey].toString().trim()}`);

                await query(`
                    UPDATE
                        translations
                    SET
                        value = ?
                    WHERE
                        item_id = ?
                    AND
                        language_code = ?
                    AND
                        type = ?
                `, [item._props[insertKey].toString().trim(), item._id, 'en', insertKey.toLowerCase()]);
            }
            logger.succeed(`Updated ${i + 1}/${allKeys.length} ${item._id} ${item._props.ShortName}`);
        }

        logger.log('Checking redirects');
        const results = await query(`SELECT source, destination FROM redirects`);
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
            //logger.log(`Checking ${source}`);
            if(!currentDestinations.includes(source)){
                continue;
            }

            logger.warn(`${source} is not a valid source`);
        }

        for(const source of sources){
            if(!destinations.includes(source)){
                continue;
            }

            logger.warn(`${source} is both a source and a destination`);
        }

        fs.writeFileSync(path.join(__dirname, '..', 'public', 'data', 'redirects.json'), JSON.stringify(Object.fromEntries(redirects), null, 4));
        logger.log('Finished checking redirects');
        logger.succeed('Finished updating translations');
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    if (!externalLogger) logger.end();
    await jobComplete();
};