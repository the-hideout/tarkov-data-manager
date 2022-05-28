const fs = require('fs');
const path = require('path');

const normalizeName = require('../modules/normalize-name');
const presetSize = require('../modules/preset-size');
const {connection, query, jobComplete} = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');

let logger = false;
let gotSizes = false;

const presetsFileExists = () => {
    try {
        fs.accessSync(path.join(__dirname, '..', 'cache', 'presets.json'))
    } catch (error) {
        return false;
    }
    return true;
}

const processPresets = async () => {
    try {
        logger.log('Updating presets');
        const presets = (await tarkovChanges.globals())['ItemPresets'];
        const items = await tarkovChanges.items();
        const en = await tarkovChanges.locale_en();
        const locales = await tarkovChanges.locales();
        const credits = await tarkovChanges.credits();

        const presetsData = {};

        const defaults = {};

        const ignorePresets = [
            '5a32808386f774764a3226d9'
        ];
        for(const presetId in presets){
            if (ignorePresets.includes(presetId)) continue;
            const preset = presets[presetId];
            const baseItem = items[preset._items[0]._tpl];
            if (!baseItem) {
                logger.warn(`Found no base item for preset ${preset._name} ${presetId}`);
                continue;
            }
            const firstItem = {
                id: baseItem._id,
                name: en.templates[baseItem._id].Name
            };
            const presetData = {
                id: presetId,
                name: en.templates[baseItem._id].Name,
                shortName: en.templates[baseItem._id].ShortName,
                //description: en.templates[baseItem._id].Description,
                normalized_name: false,
                baseId: firstItem.id,
                width: baseItem._props.Width,
                height: baseItem._props.Height,
                weight: baseItem._props.Weight,
                baseValue: credits[firstItem.id],
                backgroundColor: baseItem._props.BackgroundColor,
                bsgCategoryId: baseItem._parent,
                types: ['preset'],
                default: true,
                containsItems: [{
                    item: firstItem,
                    count: 1
                }],
                locale: {}
            }
            for (const code in locales) {
                lang = locales[code];
                presetData.locale[code] = {
                    name: lang.templates[baseItem._id].Name,
                    shortName: lang.templates[baseItem._id].ShortName
                }
            }
            for (let i = 1; i < preset._items.length; i++) {
                const part = preset._items[i];
                const partData = {
                    item: {
                        id: part._tpl,
                        name: en.templates[part._tpl].Name,
                    },
                    count: 1
                };
                if (part.upd && part.upd.StackObjectsCount) {
                    partData.count = part.upd.StackObjectsCount;
                }
                presetData.containsItems.push(partData);
                presetData.weight += (items[part._tpl]._props.Weight * partData.count);
                presetData.baseValue += (credits[part._tpl] * partData.count);
            }
            if (preset._changeWeaponName && en.preset[presetId] && en.preset[presetId].Name) {
                presetData.name += ' '+en.preset[presetId].Name;
                presetData.shortName += ' '+en.preset[presetId].Name;
                presetData.default = false;
            } 
            for (const code in locales) {
                lang = locales[code];
                if (preset._changeWeaponName && lang.preset[presetId] && lang.preset[presetId].Name) {
                    presetData.locale[code].name += ' '+lang.preset[presetId].Name;
                    presetData.locale[code].shortName += ' '+lang.preset[presetId].Name;
                }
            }
            presetData.normalized_name = normalizeName(presetData.name);
            if (gotSizes) {
                let itemPresetSize = await presetSize(presetId, false);
                if(itemPresetSize){
                    presetData.width = itemPresetSize.width;
                    presetData.height = itemPresetSize.height;
                }
            }
            presetsData[presetId] = presetData;
            if (presetData.default && !defaults[firstItem.id]) {
                defaults[firstItem.id] = presetData;
            } else if (presetData.default) {
                existingDefault = defaults[firstItem.id];
                logger.warn(`Preset ${presetData.name} ${presetId} cannot replace ${existingDefault.name} ${existingDefault.id} as default preset`);
            }
            logger.succeed(`Completed ${presetData.name} preset (${presetData.containsItems.length+1} parts)`);
        }
        logger.log('Loading default presets...');
        const queries = [];
        for (const presetId in presetsData) {
            const p = presetsData[presetId];
            if (p.default && gotSizes) {
                queries.push(query(`
                    DELETE IGNORE FROM 
                        item_children
                    WHERE container_item_id=?
                `, [p.baseId]
                ).catch(error => {
                    logger.error(`Error removing default preset items for ${p.name} ${p.id}`);
                    logger.error(error);
                }).then(async () => {
                    const insertQueries = [];
                    for (const part of p.containsItems) {
                        if (p.baseId == part.item.id) continue;
                        insertQueries.push(query(`
                            INSERT IGNORE INTO 
                                item_children (container_item_id, child_item_id, count)
                            VALUES (?, ?, ?)
                        `, [p.baseId, part.item.id, part.count])
                        .catch(error => {
                            logger.error(`Error adding default preset items for ${p.name} ${p.id}`);
                            logger.error(error);
                        }));
                    }
                    await Promise.allSettled(insertQueries);
                }).catch(error => {
                    logger.error(`Error updating default preset items for ${p.name} ${p.id}`);
                    logger.error(error);
                }));
            } else if (gotSizes) {
                queries.push(query(`
                    INSERT INTO 
                        item_data (id, name, short_name, normalized_name)
                    VALUES (
                        '${p.id}',
                        ${connection.escape(p.name)},
                        ${connection.escape(p.shortName)},
                        ${connection.escape(p.normalized_name)}
                    )
                    ON DUPLICATE KEY UPDATE
                        name=${connection.escape(p.name)},
                        short_name=${connection.escape(p.shortName)},
                        normalized_name=${connection.escape(p.normalized_name)}
                `).then(results => {
                    if(results.changedRows > 0){
                        logger.log(`${p.name} updated`);
                    }
                    if(results.insertId !== 0){
                        logger.log(`${p.name} added`);
                    }
                }));
                queries.push(query(`INSERT IGNORE INTO types (item_id, type) VALUES (?, ?)`, [p.id, 'preset']).catch(error => {
                    logger.error(`Error inerting preset type for ${p.name} ${p.id}`);
                    logger.error(error);
                }));
                for (const part of p.containsItems) {
                    queries.push(query(`
                        INSERT IGNORE INTO 
                            item_children (container_item_id, child_item_id, count)
                        VALUES (?, ?, ?)
                    `, [p.id, part.item.id, part.count])
                    .catch(error => {
                        logger.error(`Error updating preset items for ${p.name} ${p.id}`);
                        logger.error(error);
                    }));
                }
            } 
        }
        if (!gotSizes) {
            logger.warn('presets.json file did not exist, so no values inserted into database');
        }

        fs.writeFileSync(path.join(__dirname, '..', 'cache', 'presets.json'), JSON.stringify(presetsData, null, 4));
        await Promise.allSettled(queries);
    } catch (error){
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.stack
        });
    }
};

module.exports = async () => {
    logger = new JobLogger('update-presets');
    try {
        gotSizes = presetsFileExists();
        await processPresets();
        let gotSizesNow = presetsFileExists()
        if (!gotSizes && gotSizesNow) {
            gotSizes = gotSizesNow;
            logger.warn('Re-running presets to get proper sizes');
            await processPresets();
        }
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.stack
        });
    }
    logger.end();
    await jobComplete();
    logger = gotSizes = false;
};