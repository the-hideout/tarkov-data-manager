const fs = require('fs');
const path = require('path');

const normalizeName = require('../modules/normalize-name');
const { initPresetSize, getPresetSize } = require('../modules/preset-size');
const { connection, query, jobComplete} = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');
const { getTranslations, setLocales } = require('../modules/get-translation');
const remoteData = require('../modules/remote-data');

let logger = false;

module.exports = async (externalLogger = false) => {
    logger = externalLogger || new JobLogger('update-presets');
    try {
        logger.log('Updating presets');
        const presets = (await tarkovChanges.globals())['ItemPresets'];
        const items = await tarkovChanges.items();
        const en = await tarkovChanges.locale_en();
        const locales = await tarkovChanges.locales();
        const credits = await tarkovChanges.credits();
        const localItems = await remoteData.get();

        setLocales(locales);

        initPresetSize(items, credits);

        const manualPresets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'manual_presets.json')));

        const presetsData = {};

        const defaults = {};

        const ignorePresets = [
            '5a32808386f774764a3226d9'
        ];
        for (const presetId in presets) {
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
            presetData.locale = getTranslations({
                name: ['templates', baseItem._id, 'Name'],
                shortName: ['templates', baseItem._id, 'ShortName']
            }, logger);
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
                const existingPart = presetData.containsItems.find(part => part.item.id === partData.item.id);
                if (existingPart) {
                    existingPart.count += partData.count;
                } else {
                    presetData.containsItems.push(partData);
                }
            }
            presetData.weight = Math.round(presetData.weight * 100) / 100;
            if (preset._changeWeaponName && en.preset[presetId] && en.preset[presetId].Name) {
                presetData.name += ' '+en.preset[presetId].Name;
                presetData.shortName += ' '+en.preset[presetId].Name;
                //presetData.default = false;
            }
            if (preset._encyclopedia !== presetData.baseId) {
                presetData.default = false;
            }
            for (const code in presetData.locale) {
                lang = locales[code];
                if (preset._changeWeaponName && lang.preset[presetId] && lang.preset[presetId].Name) {
                    if (presetData.locale[code].name)
                        presetData.locale[code].name += ' '+lang.preset[presetId].Name;
                    if (presetData.locale[code].shortName)
                        presetData.locale[code].shortName += ' '+lang.preset[presetId].Name;
                }
            }
            presetData.normalized_name = normalizeName(presetData.name);
            let itemPresetSize = await getPresetSize(presetData, logger);
            if (itemPresetSize) {
                presetData.width = itemPresetSize.width;
                presetData.height = itemPresetSize.height;
                presetData.weight = itemPresetSize.weight;
                presetData.baseValue = itemPresetSize.baseValue;//credits[baseItem._id];
                presetData.ergonomics = itemPresetSize.ergonomics;
                presetData.verticalRecoil = itemPresetSize.verticalRecoil;
                presetData.horizontalRecoil = itemPresetSize.horizontalRecoil;
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
        // add manual presets
        for (const presetData of manualPresets) {
            const baseItem = items[presetData.baseId];
            presetData.name = en.templates[baseItem._id].Name + ' ' + presetData.appendName;
            presetData.shortName = en.templates[baseItem._id].ShortName + ' ' + presetData.appendName;
            presetData.normalized_name = normalizeName(presetData.name);
            presetData.backgroundColor = baseItem._props.BackgroundColor;
            presetData.bsgCategoryId = baseItem._parent;
            presetData.types = ['preset'];

            let itemPresetSize = await getPresetSize(presetData, logger);
            if (itemPresetSize) {
                presetData.width = itemPresetSize.width;
                presetData.height = itemPresetSize.height;
                presetData.weight = itemPresetSize.weight;
                presetData.baseValue = itemPresetSize.baseValue;
                presetData.ergonomics = itemPresetSize.ergonomics;
                presetData.verticalRecoil = itemPresetSize.verticalRecoil;
                presetData.horizontalRecoil = itemPresetSize.horizontalRecoil;
            } else {
                presetData.width = baseItem._props.Width;
                presetData.height = baseItem._props.Height;
                presetData.weight = baseItem._props.Weight;
                presetData.baseValue = credits[baseItem._id];
                presetData.ergonomics = baseItem._props.Ergonomics;
                presetData.verticalRecoil = baseItem._props.RecoilForceUp;
                presetData.horizontalRecoil = baseItem._props.RecoilForceBack;
            }

            presetData.locale = getTranslations({
                name: ['templates', baseItem._id, 'Name'],
                shortName: ['templates', baseItem._id, 'ShortName']
            }, logger);
            for (const code in presetData.locale) {
                presetData.locale[code].name += ' ' + presetData.appendName
                presetData.locale[code].shortName += ' ' + presetData.appendName
            }
            presetsData[presetData.id] = presetData;
        }
        // add dog tag preset
        const bearTag = items['59f32bb586f774757e1e8442'];
        const getDogTagName = lang => {
            return locales[lang].templates[bearTag._id].Name.replace(locales[lang].templates['59f32bb586f774757e1e8442'].ShortName, '').trim();
        };
        presetsData['customdogtags12345678910'] = {
            id: 'customdogtags12345678910',
            name: getDogTagName('en'),
            shortName: getDogTagName('en'),
            //description: en.templates[baseItem._id].Description,
            normalized_name: normalizeName(getDogTagName('en')),
            baseId: bearTag._id,
            width: bearTag._props.Width,
            height: bearTag._props.Height,
            weight: bearTag._props.Weight,
            baseValue: credits[bearTag._id],
            backgroundColor: bearTag._props.BackgroundColor,
            bsgCategoryId: bearTag._parent,
            types: ['preset', 'no-flea'],
            default: false,
            containsItems: [
                {
                    item: {
                        id: bearTag._id
                    },
                    count: 1
                },
                {
                    item: {
                        id: '59f32c3b86f77472a31742f0'
                    },
                    count: 1
                }
            ],
            locale: {}
        };
        for (const code in locales) {
            lang = locales[code];
            presetsData['customdogtags12345678910'].locale[code] = {
                name: getDogTagName(code),
                shortName: getDogTagName(code)
            }
        }
        for (const [id, item] of localItems.entries()) {
            if (!item.types.includes('gun') || item.types.includes('disabled'))
                continue;
            
            const matchingPresets = [];
            let defaultId = false;
            for (const preset of Object.values(presetsData)) {
                if (preset.baseId !== id)
                    continue;
                
                if (preset.default) {
                    defaultId = preset.id;
                    break;
                }
                matchingPresets.push(preset);
            }
            if (!defaultId) {
                if (matchingPresets.length === 1) {
                    defaultId = matchingPresets[0].id;
                    matchingPresets[0].default = true;
                }
            }
            if (!defaultId) {
                console.log(item.id, item.name, 'missing preset');
            }
        }
        logger.log('Loading default presets...');
        const queries = [];
        for (const presetId in presetsData) {
            const p = presetsData[presetId];
            if (p.default) {
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
            } else {
                queries.push(query(`
                    INSERT INTO 
                        item_data (id, name, short_name, normalized_name, properties)
                    VALUES (
                        '${p.id}',
                        ${connection.escape(p.name)},
                        ${connection.escape(p.shortName)},
                        ${connection.escape(p.normalized_name)},
                        ${connection.escape(JSON.stringify({backgroundColor: p.backgroundColor}))}
                    )
                    ON DUPLICATE KEY UPDATE
                        name=${connection.escape(p.name)},
                        short_name=${connection.escape(p.shortName)},
                        normalized_name=${connection.escape(p.normalized_name)},
                        properties=${connection.escape(JSON.stringify({backgroundColor: p.backgroundColor}))}
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

        fs.writeFileSync(path.join(__dirname, '..', 'cache', 'presets.json'), JSON.stringify(presetsData, null, 4));
        await Promise.allSettled(queries);
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.stack
        });
    }
    logger.end();
    await jobComplete();
    logger = false;
};