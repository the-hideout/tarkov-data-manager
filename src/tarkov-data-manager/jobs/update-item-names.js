// updates item names, normalized names, and redirects

const fs = require('fs');
const path = require('path');

const remoteData = require('../modules/remote-data');
const normalizeName = require('../modules/normalize-name');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

const {connection, query, jobComplete} = require('../modules/db-connection');
const tarkovData = require('../modules/tarkov-data');
const jobOutput = require('../modules/job-output');

module.exports = async (externalLogger) => {
    const logger = externalLogger || new JobLogger('update-item-names');
    try {
        const [localItems, bsgData, en, presets] = await Promise.all([
            remoteData.get(),
            tarkovData.items(),
            tarkovData.locale('en'),
            jobOutput('update-presets', './cache/presets.json', logger),
        ]);
        const currentDestinations = [];

        logger.log(`Updating names`);
        for(const localItem in localItems.values()){
            if (localItem.normalized_name) {
                currentDestinations.push(localItem.normalized_name);
            }
        }

        const doNotUse = /DO[ _]NOT[ _]USE/;
        let i = 0;
        for (const [itemId, localItem] of localItems.entries()) {
            i++;
            const item = bsgData[itemId];
            if((!item || !item._props) && !presets[itemId]){
                continue;
            }

            let name = localItem.name;
            let shortname = localItem.short_name;
            let normalized = localItem.normalized_name;
            let bgColor = localItem.properties.backgroundColor;
            if (item) {
                name = item._props.Name.toString().trim();
                name = en[`${itemId} Name`].toString().trim();
                shortname = en[`${itemId} ShortName`].toString().trim();
                bgColor = item._props.BackgroundColor;
            } else if (presets[itemId]) {
                name = presets[itemId].name;
                shortname = presets[itemId].shortName;
                bgColor = presets[itemId].backgroundColor;
            }
            if ((!name || name == null) && normalized) {
                name = normalized;
            } else if (name && !normalized) {
                normalized = normalizeName(name);
            }

            if (name !== localItem.name || shortname !== localItem.short_name || normalized !== localItem.normalized_name || bgColor !== localItem.properties.backgroundColor) {
                if (localItem.name.match(doNotUse) && !name.match(doNotUse)) {
                    query(`DELETE FROM types WHERE item_id = ? AND type = 'disabled'`, [itemId]);
                }
                try {
                    await query(`
                        UPDATE item_data 
                        SET
                            name = ${connection.escape(name)},
                            short_name = ${connection.escape(shortname)},
                            normalized_name = ${connection.escape(normalized)},
                            properties = ${connection.escape(JSON.stringify({backgroundColor: bgColor}))}
                        WHERE
                            id = '${itemId}'
                    `);
                    logger.succeed(`Updated ${i}/${localItems.size} ${itemId} ${shortname || name}`);            
                } catch (error) {
                    logger.error(`Error updating item names for ${itemId} ${name}`);
                    logger.error(error);
                }
            }

            const oldKey = localItem.normalized_name;
            const newKey = normalizeName(name);

            if (oldKey !== newKey && currentDestinations.includes(oldKey)){
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
        logger.succeed('Finished updating redirects');
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