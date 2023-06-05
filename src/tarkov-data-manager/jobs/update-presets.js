const fs = require('fs');
const path = require('path');

const normalizeName = require('../modules/normalize-name');
const { initPresetData, getPresetData } = require('../modules/preset-data');
const tarkovData = require('../modules/tarkov-data');
const { getTranslations, setLocales } = require('../modules/get-translation');
const remoteData = require('../modules/remote-data');
const { regenerateFromExisting } = require('../modules/image-create');
const DataJob = require('../modules/data-job');

class UpdatePresetsJob extends DataJob {
    constructor() {
        super('update-presets');
        this.writeFolder = 'cache';
        this.kvName = 'presets';
    }

    run = async () => {
        this.logger.log('Updating presets');
        const [presets, items, locales, credits, localItems] = await Promise.all([
            tarkovData.globals().then(glob => glob['ItemPresets']),
            tarkovData.items(),
            tarkovData.locales(),
            tarkovData.credits(),
            remoteData.get(),
        ]);

        setLocales(locales);

        initPresetData(items, credits);

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
                this.logger.warn(`Found no base item for preset ${preset._name} ${presetId}`);
                continue;
            }
            const firstItem = {
                id: baseItem._id,
                name: locales.en[`${baseItem._id} Name`]
            };
            const presetData = {
                id: presetId,
                name: locales.en[`${baseItem._id} Name`],
                shortName: locales.en[`${baseItem._id} ShortName`],
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
                name: `${baseItem._id} Name`,
                shortName: `${baseItem._id} ShortName`
            }, this.logger);
            for (let i = 1; i < preset._items.length; i++) {
                const part = preset._items[i];
                const partData = {
                    item: {
                        id: part._tpl,
                        name: locales.en[`${part._tpl} Name`],
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
            if (preset._changeWeaponName && locales.en[presetId]) {
                presetData.name += ' '+locales.en[presetId];
                presetData.shortName += ' '+locales.en[presetId];
                presetData.locale = getTranslations({
                    name: (lang) => {
                        return lang[`${firstItem.id} Name`] + ' ' + lang[presetId];
                    },
                    shortName: (lang) => {
                        return lang[`${firstItem.id} ShortName`] + ' ' + lang[presetId];
                    }
                }, this.logger);
            }
            if (preset._encyclopedia !== presetData.baseId) {
                presetData.default = false;
            }
            presetData.normalized_name = normalizeName(presetData.name);
            let itemPresetData = await getPresetData(presetData, this.logger);
            if (itemPresetData) {
                presetData.width = itemPresetData.width;
                presetData.height = itemPresetData.height;
                presetData.weight = itemPresetData.weight;
                presetData.baseValue = itemPresetData.baseValue;//credits[baseItem._id];
                presetData.ergonomics = itemPresetData.ergonomics;
                presetData.verticalRecoil = itemPresetData.verticalRecoil;
                presetData.horizontalRecoil = itemPresetData.horizontalRecoil;
                presetData.moa = itemPresetData.moa;
            }
            presetsData[presetId] = presetData;
            if (presetData.default && !defaults[firstItem.id]) {
                defaults[firstItem.id] = presetData;
            } else if (presetData.default) {
                existingDefault = defaults[firstItem.id];
                this.logger.warn(`Preset ${presetData.name} ${presetId} cannot replace ${existingDefault.name} ${existingDefault.id} as default preset`);
            }
            this.logger.succeed(`Completed ${presetData.name} preset (${presetData.containsItems.length+1} parts)`);
        }
        // add manual presets
        for (const presetData of manualPresets) {
            const baseItem = items[presetData.baseId];
            presetData.backgroundColor = baseItem._props.BackgroundColor;
            presetData.bsgCategoryId = baseItem._parent;
            presetData.types = ['preset'];

            let itemPresetData = await getPresetData(presetData, this.logger);
            if (itemPresetData) {
                presetData.width = itemPresetData.width;
                presetData.height = itemPresetData.height;
                presetData.weight = itemPresetData.weight;
                presetData.baseValue = itemPresetData.baseValue;
                presetData.ergonomics = itemPresetData.ergonomics;
                presetData.verticalRecoil = itemPresetData.verticalRecoil;
                presetData.horizontalRecoil = itemPresetData.horizontalRecoil;
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
                name: (lang) => {
                    return lang[`${baseItem._id} Name`] + ' ' + (lang[presetData.appendName] || locales.en[presetData.appendName]);
                },
                shortName: (lang) => {
                    return lang[`${baseItem._id} ShortName`] + ' ' + (lang[presetData.appendName] || locales.en[presetData.appendName]);
                }
            }, this.logger);
            presetData.name = presetData.locale.en.name;
            presetData.shortName = presetData.locale.en.shortName;
            presetData.normalized_name = normalizeName(presetData.name);
            delete presetData.appendName;
            presetsData[presetData.id] = presetData;
            this.logger.succeed(`Completed ${presetData.name} manual preset (${presetData.containsItems.length} parts)`);
        }
        // add dog tag preset
        const bearTag = items['59f32bb586f774757e1e8442'];
        const getDogTagName = lang => {
            return lang[`${bearTag._id} Name`].replace(lang['59f32bb586f774757e1e8442 ShortName'], '').trim().replace(/^\p{Ll}/gu, substr => {
                return substr.toUpperCase();
            });
        };
        presetsData['customdogtags12345678910'] = {
            id: 'customdogtags12345678910',
            name: getDogTagName(locales.en),
            shortName: getDogTagName(locales.en),
            //description: en.templates[baseItem._id].Description,
            normalized_name: normalizeName(getDogTagName(locales.en)),
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
            locale: getTranslations({name: getDogTagName, shortName: getDogTagName}, this.logger)
        };

        // check for missing default presets
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
            if (!defaultId && items[item.id]._props.Slots.length > 0) {
                this.logger.log(`${item.id} ${item.name} missing preset`);
            }
        }

        // add "Default" to the name of default presets to differentiate them from gun names
        for (const presetId in presetsData) {
            const preset = presetsData[presetId];
            if (!preset.default) {
                continue;
            }
            const baseName = preset.containsItems.find(contained => contained.item.id === preset.baseId).item.name;
            if (baseName !== preset.name) {
                continue;
            }
            preset.name = preset.name + ' ' + locales.en.Default;
            preset.normalized_name = normalizeName(preset.name);
            preset.locale = getTranslations({
                name: (lang) => {
                    return lang[`${preset.baseId} Name`] + ' ' + lang.Default;
                },
                shortName: (lang) => {
                    return lang[`${preset.baseId} ShortName`] + ' ' + lang.Default;
                }
            }, this.logger);
        }

        const regnerateImages = [];
        for (const item of Object.values(localItems)) {
            if (!item.types.includes('preset')) {
                continue;
            }
            if (!presetsData[item.id]) {
                this.logger.warn(`DB preset no longer present: ${item.name} ${item.id}`);
                continue;
            }
            const p = presetsData[item.id];
            if (item.short_name !== p.shortName || item.width !== p.width || item.height !== p.height || item.properties.backgroundColor !== p.backgroundColor) {
                regnerateImages.push(p);
            }
        }
        this.logger.log('Updating presets in DB...');
        const queries = [];
        const newPresets = [];
        for (const presetId in presetsData) {
            const p = presetsData[presetId];
            queries.push(remoteData.addItem({
                id: p.id,
                name: p.name,
                short_name: p.shortName,
                normalized_name: p.normalized_name,
                width: p.width,
                height: p.height,
                properties: {backgroundColor: p.backgroundColor},
            }).then(results => {
                /*if (results.affectedRows > 0) {
                    this.logger.log(`${p.name} updated`);
                }*/
                if (results.insertId !== 0) {
                    this.logger.log(`${p.name} added`);
                    newPresets.push(`${p.name} ${presetId}`);
                }
            }).catch(error => {
                this.logger.error(`Error updating preset in DB`);
                this.logger.error(error);
            }));
            queries.push(remoteData.addType(p.id, 'preset').catch(error => {
                this.logger.error(`Error inserting preset type for ${p.name} ${p.id}`);
                this.logger.error(error);
            }));
        }
        if (newPresets.length > 0) {
            this.discordAlert({
                title: 'Added preset(s)',
                message: newPresets.join('\n'),
            })
        }
        if (regnerateImages.length > 0) {
            this.logger.log(`Regenerating ${regnerateImages.length} preset images`);
            for (const item of regnerateImages) {
                this.logger.log(`Regerating images for ${item.name} ${item.id}`);
                await regenerateFromExisting(id, true).catch(errors => {
                    if (Array.isArray(errors)) {
                        this.logger.error(`Error regenerating images for ${item.id}: ${errors.map(error => error.message).join(', ')}`);
                    } else {
                        this.logger.error(`Error regenerating images for ${item.id}: ${errors.message}`);
                    }
                });
            }
            this.logger.succeed('Finished regenerating images');
            this.discordAlert({
                title: 'Regenerated images for preset(s) after name/size/background color change',
                message: regnerateImages.map(item => `${item.name} ${item.id}`).join('\n'),
            });
        }

        fs.writeFileSync(path.join(__dirname, '..', this.writeFolder, `${this.kvName}.json`), JSON.stringify(presetsData, null, 4));
        await Promise.allSettled(queries);
        return presetsData;
    }
}

module.exports = UpdatePresetsJob;
