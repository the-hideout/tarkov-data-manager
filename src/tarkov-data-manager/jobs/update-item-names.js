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
        const normalizedNames = {};
        const doNotUse = /DO[ _]NOT[ _]USE|translation_pending/;
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
            let width = localItem.width;
            let height = localItem.height;
            if (item) {
                if (!en[`${itemId} Name`]) {
                    logger.log(`No en translation found for ${itemId} ${item._name}`);
                    continue;
                }
                //name = item._props.Name.toString().trim();
                name = en[`${itemId} Name`].toString().trim();
                shortname = en[`${itemId} ShortName`].toString().trim();
                normalized = name ? normalizeName(name) : normalized;
                bgColor = item._props.BackgroundColor;
                width = item._props.Width;
                height = item._props.Height;
            } /*else if (presets[itemId]) {
                name = presets[itemId].name;
                shortname = presets[itemId].shortName;
                bgColor = presets[itemId].backgroundColor;
            }*/
            if ((!name || name == null) && normalized) {
                name = normalized;
            } else if (name && !normalized) {
                normalized = normalizeName(name);
            }

            if (!localItem.types.includes('disabled')) {
                if (normalizedNames[normalized]) {
                    let counter = 1;
                    while (normalizedNames[`${normalized}-${counter}`]) {
                        counter++;
                    }
                    normalized = `${normalized}-${counter}`;
                }
                normalizedNames[normalized] = itemId;
            }

            if (name !== localItem.name || 
                shortname !== localItem.short_name || 
                normalized !== localItem.normalized_name || 
                bgColor !== localItem.properties.backgroundColor || 
                width !== localItem.width ||
                height !== localItem.height) {
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
                            width = ${connection.escape(width)},
                            height = ${connection.escape(height)},
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

        let redirects = results
            .map(row => {
                return [
                    `/item/${row.source}`,
                    `/item/${row.destination}`,
                ];
            })
            .filter(Boolean);
        redirects = Object.fromEntries(redirects);

        for (const source in redirects) {
            //logger.log(`Checking ${source}`);
            if (!currentDestinations.includes(source)){
                continue;
            }

            logger.warn(`${source} is not a valid redirect source`);
            await query(`DELETE FROM redirects WHERE source = ?`, [source.replace(/^\/item\//, '')]);
        }

        for (const source in redirects) {
            if (!redirects[redirects[source]]) {
                continue;
            }
            const startDestination = redirects[source];
            let finalDestination = redirects[startDestination];
            while (finalDestination) {
                redirects[source] = finalDestination;
                finalDestination = redirects[redirects[source]];
            }
            if (startDestination !== redirects[source]) {
                logger.warn(`${source} is both a redirect source and destination`);
                await query(`UPDATE redirects SET destination = ? WHERE source = ?`, [
                    redirects[source].replace(/^\/item\//, ''), 
                    source.replace(/^\/item\//, '')
                ]);
            }
        }

        fs.writeFileSync(path.join(__dirname, '..', 'public', 'data', 'redirects.json'), JSON.stringify(redirects, null, 4));
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