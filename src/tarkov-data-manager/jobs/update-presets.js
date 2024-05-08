const fs = require('fs');
const path = require('path');

const { imageFunctions } = require('tarkov-dev-image-generator');

const normalizeName = require('../modules/normalize-name');
const { initPresetData, getPresetData } = require('../modules/preset-data');
const tarkovData = require('../modules/tarkov-data');
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
        const [presets, items, credits, localItems] = await Promise.all([
            tarkovData.globals().then(glob => glob['ItemPresets']),
            tarkovData.items(),
            tarkovData.credits(),
            remoteData.get(),
        ]);

        initPresetData(items, credits);

        JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'manual_presets.json'))).forEach(p => {
            p._changeWeaponName = true;
            presets[p._id] = p;
        });

        this.presetsData = {};
        this.kvData.presets = this.presetsData;

        const defaults = {};

        const ignorePresets = [
            '5a8c436686f7740f394d10b5' // Glock 17 Tac HC is duplicate of Tac 3 5a88ad7b86f77479aa7226af
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
                name: this.getTranslation([`${baseItem._id} Name`])
            };
            const presetData = {
                id: presetId,
                name: this.addTranslation(`${presetId} Name`, (lang, langCode) => {
                    let baseName = lang[`${firstItem.id} Name`];
                    if (!baseName && langCode !== 'en') {
                        baseName = this.locales.en[`${firstItem.id} Name`];
                    }
                    if (!preset._changeWeaponName) {
                        return baseName;
                    }
                    const append = preset.appendName || presetId;
                    if (lang[append]) {
                        return baseName + ' ' + lang[append];
                    }
                    if (langCode !== 'en'  && this.locales.en[append]) {
                        return baseName + ' ' + this.locales.en[append];
                    }
                    return baseName;
                }),
                shortName: this.addTranslation(`${presetId} ShortName`, (lang, langCode) => {
                    let baseName = lang[`${firstItem.id} ShortName`];
                    if (!baseName && langCode !== 'en') {
                        baseName = this.locales.en[`${firstItem.id} ShortName`];
                    }
                    if (!preset._changeWeaponName) {
                        return baseName;
                    }
                    const append = preset.appendName || presetId;
                    if (lang[append]) {
                        return baseName + ' ' + lang[append];
                    }
                    if (langCode !== 'en'  && this.locales.en[append]) {
                        return baseName + ' ' + this.locales.en[append];
                    }
                    return baseName;
                }),
                //description: en.templates[baseItem._id].Description,
                normalized_name: false,
                baseId: firstItem.id,
                width: baseItem._props.Width,
                height: baseItem._props.Height,
                weight: Math.round(baseItem._props.Weight * 100) / 100,
                baseValue: credits[firstItem.id],
                ergonomics: baseItem._props.Ergonomics,
                verticalRecoil: baseItem._props.RecoilForceUp,
                horizontalRecoil: baseItem._props.RecoilForceBack,
                backgroundColor: baseItem._props.BackgroundColor,
                bsgCategoryId: baseItem._parent,
                types: ['preset'],
                default: preset._encyclopedia === firstItem.id,
                items: preset._items.filter(i => items[i._tpl]._parent !== '65649eb40bf0ed77b8044453'), // skip built-in armor parts
                containsItems: [{
                    item: firstItem,
                    count: 1
                }],
                armorOnly: true,
                noFlea: !items[baseItem._id]._props.CanSellOnRagfair,
            };

            // add parts to preset
            // check if any are flea banned
            for (let i = 1; i < presetData.items.length; i++) {
                const part = presetData.items[i];
                if (!items[part._tpl]._props.CanSellOnRagfair) {
                    presetData.noFlea = true;
                }
                if (items[part._tpl]._parent !== '644120aa86ffbe10ee032b6f') {
                    presetData.armorOnly = false;
                }
                const partData = {
                    item: {
                        id: part._tpl,
                        name: this.getTranslation([`${part._tpl} Name`]),
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
            if (presetData.containsItems.length === 1) {
                this.logger.log(`Skipping empty preset for ${this.getTranslation(presetData.name)}`);
                const dbItem = localItems.get(presetId);
                if (dbItem && !dbItem.types.includes('disabled')) {
                    await remoteData.addType(presetId, 'disabled');
                }
                continue;
            }
            presetData.normalized_name = normalizeName(this.getTranslation(presetData.name));
            this.validateNormalizedName(presetData);
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
            this.presetsData[presetId] = presetData;
            if (presetData.default && !defaults[firstItem.id]) {
                defaults[firstItem.id] = presetData;
            } else if (presetData.default) {
                const existingDefault = defaults[firstItem.id];
                this.logger.warn(`Preset ${presetData.name} ${presetId} cannot replace ${existingDefault.name} ${existingDefault.id} as default preset`);
            }
            this.logger.succeed(`Completed ${this.getTranslation(presetData.name)} preset (${presetData.containsItems.length} parts)`);
        }

        // add dog tag preset
        const bearTag = items['59f32bb586f774757e1e8442'];
        const getDogTagName = lang => {
            return lang[`${bearTag._id} Name`].replace(lang['59f32bb586f774757e1e8442 ShortName'], '').trim().replace(/^\p{Ll}/gu, substr => {
                return substr.toUpperCase();
            });
        };
        this.presetsData['customdogtags12345678910'] = {
            id: 'customdogtags12345678910',
            name: this.addTranslation('customdogtags12345678910 Name', getDogTagName),
            shortName: this.addTranslation('customdogtags12345678910 ShortName', getDogTagName),
            //name: getDogTagName(this.locales.en),
            //shortName: getDogTagName(this.locales.en),
            //description: en.templates[baseItem._id].Description,
            normalized_name: normalizeName(this.getTranslation('customdogtags12345678910 Name')),
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
            items: [
                {
                    _id: '000000000000000000000001',
                    _tpl: bearTag._id,
                },
                {
                    _id: '000000000000000000000002',
                    _tpl: '59f32c3b86f77472a31742f0',
                }
            ]
        };

        // check for missing default presets
        for (const [id, item] of localItems.entries()) {
            if (!item.types.includes('gun') || item.types.includes('disabled'))
                continue;
            
            const matchingPresets = [];
            let defaultId = false;
            for (const preset of Object.values(this.presetsData)) {
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
        for (const presetId in this.presetsData) {
            const preset = this.presetsData[presetId];
            if (!preset.default) {
                continue;
            }
            const baseName = preset.containsItems.find(contained => contained.item.id === preset.baseId).item.name;
            if (baseName !== this.getTranslation(preset.name)) {
                continue;
            }
            preset.name = this.addTranslation(`${presetId} Name`, (lang, langCode) => {
                if (langCode !== 'en' && (!lang[`${preset.baseId} Name`] || !lang.Default)) {
                    lang = this.locales.en;
                }
                return lang[`${preset.baseId} Name`] + ' ' + lang.Default;
            });
            preset.shortName = this.addTranslation(`${presetId} ShortName`, (lang, langCode) => {
                if (langCode !== 'en' && (!lang[`${preset.baseId} ShortName`] || !lang.Default)) {
                    lang = this.locales.en;
                }
                return lang[`${preset.baseId} ShortName`] + ' ' + lang.Default;
            })
            preset.normalized_name = normalizeName(this.getTranslation(preset.name));
        }

        const queries = [];
        const regnerateImages = [];
        for (const [id, item] of localItems.entries()) {
            if (!item.types.includes('preset')) {
                continue;
            }
            if (item.types.includes('disabled')) {
                continue;
            }
            if (!this.presetsData[id]) {
                this.logger.warn(`Preset ${item.name} ${id} is no longer valid; disabling`);
                queries.push(remoteData.addType(id, 'disabled').catch(error => {
                    this.logger.error(`Error disabling ${item.name} ${id}`);
                    this.logger.error(error);
                }));
                continue;
            }
            const p = this.presetsData[id];
            if (p.armorOnly) {
                continue;
            }
            if (item.short_name !== this.getTranslation(p.shortName) || item.width !== p.width || item.height !== p.height || item.properties.backgroundColor !== p.backgroundColor) {
                regnerateImages.push(p);
            }
        }

        this.logger.log('Updating presets in DB...');
        const newPresets = [];
        for (const presetId in this.presetsData) {
            const p = this.presetsData[presetId];
            queries.push(remoteData.addItem({
                id: p.id,
                name: this.getTranslation(p.name),
                short_name: this.getTranslation(p.shortName),
                normalized_name: p.normalized_name,
                width: p.width,
                height: p.height,
                properties: {backgroundColor: p.backgroundColor, items: p.items},
            }).then(results => {
                /*if (results.affectedRows > 0) {
                    this.logger.log(`${p.name} updated`);
                }*/
                if (results.insertId !== 0) {
                    this.logger.log(`${p.name} added`);
                    newPresets.push(`${p.name} ${presetId}`);
                }    
                if (p.armorOnly) {
                    // this preset consists of only armor items
                    // shares images with base item
                    const baseItem = localItems.get(p.baseId);
                    const pItem = localItems.get(p.id);
                    const updateFields = {};
                    for (const imgType in imageFunctions.imageSizes) {
                        const fieldName = imageFunctions.imageSizes[imgType].field;
                        if (!pItem[fieldName] && baseItem[fieldName]) {
                            updateFields[fieldName] = baseItem[fieldName];
                        }
                    }
                    if (Object.keys(updateFields).length > 0) {
                        this.logger.log(`Updating ${p.name} ${p.id} images to match base item (${baseItem.id}) images`);
                        queries.push(remoteData.setProperties(p.id, updateFields).catch(error => {
                            console.log(error);
                            this.logger.error(`Error updating ${p.name} ${p.id} images to base ${baseItem.id} images: ${error.message}`);
                        }));
                    }
                }
            }).catch(error => {
                this.logger.error(`Error updating preset in DB`);
                this.logger.error(error);
            }));
            const localItem = localItems.get(p.id);
            if (!localItem?.types.includes('preset')) {
                queries.push(remoteData.addType(p.id, 'preset').catch(error => {
                    this.logger.error(`Error inserting preset type for ${p.name} ${p.id}`);
                    this.logger.error(error);
                }));
            }
            if (p.noFlea && !localItem?.types.includes('no-flea')) {    
                queries.push(remoteData.addType(p.id, 'no-flea').catch(error => {
                    this.logger.error(`Error inserting no-flea type for ${p.name} ${p.id}`);
                    this.logger.error(error);
                }));
            } else if (!p.noFlea && localItem?.types.includes('no-flea')) {
                queries.push(remoteData.removeType(p.id, 'no-flea').catch(error => {
                    this.logger.error(`Error removing no-flea type for ${p.name} ${p.id}`);
                    this.logger.error(error);
                }));
            }
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
                title: 'Regenerated images for preset(s) after name/size/background color change',
                message: regnerateImages.map(item => `${this.getTranslation(item.name)} ${item.id}`).join('\n'),
            });
        }

        // make sure we don't include any disabled presets
        this.presetsData = Object.keys(this.presetsData).reduce((all, presetId) => {
            //console.log(`${presetId} ${localItems.has(presetId)} ${localItems.get(presetId)?.types.includes('disabled')}`);
            if (localItems.has(presetId) && !localItems.get(presetId).types?.includes('disabled')) {
                all[presetId] = this.presetsData[presetId];
            }
            return all;
        }, {});

        for (const langCode in this.kvData.locale) {
            for (const key in this.kvData.locale[langCode]) {
                if (!Object.values(this.presetsData).some(preset => preset.name === key || preset.shortName === key)) {
                    this.removeTranslation(key);
                }
            }
        }

        await this.fillTranslations();
        fs.writeFileSync(path.join(__dirname, '..', this.writeFolder, `${this.kvName}.json`), JSON.stringify(this.kvData, null, 4));
        await Promise.allSettled(queries);
        return this.kvData;
    }

    validateNormalizedName = (preset, attempt = 1) => {
        let normal = preset.normalized_name;
        if (attempt > 1) {
            normal += `-${attempt}`;
        }
        const matchedPreset = Object.values(this.presetsData).find(p => p.normalized_name === normal);
        if (matchedPreset) {
            return this.validateNormalizedName(preset, attempt + 1);
        }
        if (attempt > 1) {
            preset.normalized_name = normal;
            //this.logger.log(normal);
        }
    }
}

module.exports = UpdatePresetsJob;
