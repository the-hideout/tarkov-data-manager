// updates item names, normalized names, size, background color, and redirects

import fs from 'node:fs';
import path from 'node:path';

import remoteData from '../modules/remote-data.mjs';
import normalizeName from '../modules/normalize-name.js';

import DataJob from '../modules/data-job.mjs';
import { regenerateFromExisting } from '../modules/image-create.mjs';
import tarkovData from '../modules/tarkov-data.mjs';

class UpdateItemNamesJob extends DataJob {
    constructor() {
        super('update-item-names');
    }

    run = async () => {
        const [localItems, bsgData, en] = await Promise.all([
            remoteData.get(),
            tarkovData.items(),
            tarkovData.locale('en'),
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
        const enabledItems = [];
        const changedItems = [];
        let i = 0;
        for (const [itemId, localItem] of localItems.entries()) {
            i++;
            const item = bsgData[itemId];
            if (!item || !item._props) {
                // use to periodically clean up the DB
                /*if (!item && !localItem.types.includes('preset') && localItem.types.includes('disabled') && !await remoteData.hasPrices(itemId)) {
                    await this.query('DELETE FROM item_data WHERE id = ?', [itemId]);
                    await this.query('DELETE FROM types WHERE item_id = ?', [itemId]);
                    this.logger.log(`Deleted removed item ${localItem.name} ${itemId}`);
                }*/
                continue;
            }

            let name = localItem.name;
            let shortname = localItem.short_name;
            let normalized = localItem.normalized_name;
            let bgColor = localItem.properties.backgroundColor;
            let width = localItem.width;
            let height = localItem.height;

            if (!en[`${itemId} Name`]) {
                if (!localItem.types.includes('disabled')) {
                    this.discordAlert({
                        title: 'Disabling Item',
                        message: `Disabling item ${name} ${itemId} for not having a current translation`,
                    });
                    await remoteData.addType(itemId, 'disabled');
                }
                this.logger.log(`No en translation found for ${itemId} ${item._name}`);
                continue;
            }
            name = en[`${itemId} Name`].toString().trim();
            shortname = en[`${itemId} ShortName`].toString().trim();
            normalized = name ? normalizeName(name) : normalized;
            bgColor = item._props.BackgroundColor;
            width = item._props.Width;
            height = item._props.Height;
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

            if (bgColor !== localItem.properties.backgroundColor || shortname !== localItem.short_name || width !== localItem.width || height !== localItem.height) {
                regnerateImages.push(localItem);
            }

            if (name !== localItem.name || 
                shortname !== localItem.short_name || 
                normalized !== localItem.normalized_name || 
                bgColor !== localItem.properties.backgroundColor || 
                width !== localItem.width ||
                height !== localItem.height) {
                if (localItem.name.match(doNotUse) && !name.match(doNotUse)) {
                    remoteData.removeType(itemId, 'disabled');
                    enabledItems.push(`${name} ${itemId} (was ${localItem.name})`);
                }
                try {
                    await remoteData.setProperties(itemId, {
                        name: name,
                        short_name: shortname,
                        normalized_name: normalized,
                        width: width,
                        height: height,
                        properties: {backgroundColor: bgColor},
                    });
                    this.logger.succeed(`Updated ${i}/${localItems.size} ${itemId} ${shortname || name}`);            
                    changedItems.push(`${name} ${itemId}`);
                } catch (error) {
                    this.logger.error(`Error updating item names for ${itemId} ${name}`);
                    this.logger.error(error);
                }
            }

            const oldKey = localItem.normalized_name;
            const newKey = normalizeName(name);

            if (oldKey !== newKey && currentDestinations.includes(oldKey)){
                try {
                    await this.query(`
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

        if (enabledItems.length > 0) {
            this.discordAlert({
                title: 'Enabled item(s) after rename',
                message: enabledItems.join('\n'),
            });
        }
        if (changedItems.length > 0) {
            this.discordAlert({
                title: 'Changed item(s) name, shortName, background color, or size',
                message: changedItems.join('\n'),
            });
        }

        this.logger.log('Checking redirects');
        const results = await this.query(`SELECT source, destination FROM redirects`);

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
            await this.query(`DELETE FROM redirects WHERE source = ?`, [source.replace(/^\/item\//, '')]);
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
                await this.query(`UPDATE redirects SET destination = ? WHERE source = ?`, [
                    redirects[source].replace(/^\/item\//, ''), 
                    source.replace(/^\/item\//, '')
                ]);
            }
        }

        fs.writeFileSync(path.join(import.meta.dirname, '..', 'public', 'data', 'redirects.json'), JSON.stringify(redirects, null, 4));
        this.logger.succeed('Finished updating redirects');

        if (regnerateImages.length > 0) {
            this.logger.log(`Regenerating ${regnerateImages.length} item images`);
            for (const item of regnerateImages) {
                this.logger.log(`Regerating images for ${item.name} ${item.id}`);
                await regenerateFromExisting(item.id, true).catch(errors => {
                    if (Array.isArray(errors)) {
                        this.logger.error(`Error regenerating images for ${item.id}: ${errors.map(error => error.message).join(', ')}`);
                    } else {
                        this.logger.error(`Error regenerating images for ${item.id}: ${errors.message}`);
                    }
                });
            }
            this.logger.succeed('Finished regenerating images');
            this.discordAlert({
                title: 'Regenerated images for item(s) after name/size/background color change',
                message: regnerateImages.map(item => `${item.name} ${item.id}`).join('\n'),
            });
        }
    }
}

export default UpdateItemNamesJob;
