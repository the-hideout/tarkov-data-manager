// updates item names, normalized names, and redirects

const fs = require('fs');
const path = require('path');

const remoteData = require('../modules/remote-data');
const normalizeName = require('../modules/normalize-name');

const { query } = require('../modules/db-connection');
const { regenerateFromExisting } = require('../modules/image-create')
const tarkovData = require('../modules/tarkov-data');
const DataJob = require('../modules/data-job');

class UpdateItemNamesJob extends DataJob {
    constructor() {
        super('update-item-names');
    }

    run = async () => {
        const [localItems, bsgData, en, presets] = await Promise.all([
            remoteData.get(),
            tarkovData.items(),
            tarkovData.locale('en'),
            this.jobManager.jobOutput('update-presets', this, true),
        ]);
        const currentDestinations = [];
        const regnerateImages = [];

        this.logger.log(`Updating names`);
        for(const localItem in localItems.values()){
            if (localItem.normalized_name) {
                currentDestinations.push(localItem.normalized_name);
            }
        }
        const normalizedNames = {
            normal: {},
            quest: {},
        };
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
                    this.logger.log(`No en translation found for ${itemId} ${item._name}`);
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
                const normalType = localItem.types.includes('quest') ? 'quest' : 'normal';
                if (normalizedNames[normalType][normalized]) {
                    let counter = 1;
                    while (normalizedNames[normalType][`${normalized}-${counter}`]) {
                        counter++;
                    }
                    normalized = `${normalized}-${counter}`;
                }
                normalizedNames[normalType][normalized] = itemId;
            }

            if (bgColor !== localItem.properties.backgroundColor || shortname !== localItem.short_name) {
                regnerateImages.push(itemId);
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
                    /*await query(`
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
                    `);*/
                    await remoteData.setProperties(itemId, {
                        name: name,
                        short_name: shortname,
                        normalized_name: normalized,
                        width: width,
                        height: height,
                        properties: {backgroundColor: bgColor},
                    });
                    this.logger.succeed(`Updated ${i}/${localItems.size} ${itemId} ${shortname || name}`);            
                } catch (error) {
                    this.logger.error(`Error updating item names for ${itemId} ${name}`);
                    this.logger.error(error);
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
                    this.logger.error(redirectInsertError);
                }
            }
        }

        this.logger.log('Checking redirects');
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
            //this.logger.log(`Checking ${source}`);
            if (!currentDestinations.includes(source)){
                continue;
            }

            this.logger.warn(`${source} is not a valid redirect source`);
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
                this.logger.warn(`${source} is both a redirect source and destination`);
                await query(`UPDATE redirects SET destination = ? WHERE source = ?`, [
                    redirects[source].replace(/^\/item\//, ''), 
                    source.replace(/^\/item\//, '')
                ]);
            }
        }

        fs.writeFileSync(path.join(__dirname, '..', 'public', 'data', 'redirects.json'), JSON.stringify(redirects, null, 4));
        this.logger.succeed('Finished updating redirects');

        if (regnerateImages.length > 0) {
            this.logger.log(`Regenerating ${regnerateImages.length} item images due to changed background`);
            for (const id of regnerateImages) {
                this.logger.log(`Regerating images for ${id}`);
                await regenerateFromExisting(id, true).catch(errors => {
                    if (Array.isArray(errors)) {
                        this.logger.error(`Error regenerating images for ${id}: ${errors.map(error => error.message).join(', ')}`);
                    } else {
                        this.logger.error(`Error regenerating images for ${id}: ${errors.message}`);
                    }
                });
            }
            this.logger.succeed('Finished regenerating images');
        }
    }
}

module.exports = UpdateItemNamesJob;
