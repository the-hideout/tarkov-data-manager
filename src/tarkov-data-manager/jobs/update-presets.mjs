import fs from 'node:fs';
import path from 'node:path';

import imgGen from 'tarkov-dev-image-generator';

import DataJob from '../modules/data-job.mjs';
import presetsHelper from '../modules/preset-data.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import remoteData from '../modules/remote-data.mjs';
import { regenerateFromExisting } from '../modules/image-create.mjs';

const { imageFunctions } = imgGen;

class UpdatePresetsJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-presets', loadLocales: true});
        this.writeFolder = 'cache';
        this.kvName = 'presets';
    }

    run = async () => {
        this.logger.log('Updating presets');
        [this.presets, this.items, this.credits, this.dbItems] = await Promise.all([
            presetsHelper.getGamePresets(),
            tarkovData.items(),
            tarkovData.credits(),
            remoteData.get(),
        ]);

        presetsHelper.init(this.items, this.credits, this.locales);

        const dbPresets = await presetsHelper.getDatabasePresets();

        for (const p of Object.values(dbPresets)) {
            this.presets[p._id] = p;
        }

        this.presetsData = {};

        const defaults = {};

        const ignorePresets = [
            '5a8c436686f7740f394d10b5' // Glock 17 Tac HC is duplicate of Tac 3 5a88ad7b86f77479aa7226af
        ];
        for (const presetId in this.presets) {
            if (ignorePresets.includes(presetId)) {
                continue;
            }
            try {
                const { preset: presetData, locale: presetLocale} = await presetsHelper.processGamePreset(this.presets[presetId]);
                this.presetsData[presetId] = presetData;
                if (presetData.default && !defaults[presetData.baseId]) {
                    defaults[presetData.baseId] = presetData;
                } else if (presetData.default) {
                    const existingDefault = defaults[presetData.baseId];
                    this.logger.warn(`Preset ${presetData.name} ${presetId} cannot replace ${existingDefault.name} ${existingDefault.id} as default preset`);
                }
                this.mergeTranslations(presetLocale);
                this.logger.succeed(`Completed ${this.getTranslation(presetData.name)} preset (${presetData.containsItems.length} parts)`);
            } catch (error) {
                if (error.message.includes('empty preset')) {
                    this.logger.warn(error.message);
                    continue;
                }
                throw error;
            }
        }

        // add dog tag preset
        const bearTag = this.items['59f32bb586f774757e1e8442'];
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
            normalized_name: this.normalizeName(this.getTranslation('customdogtags12345678910 Name')),
            baseId: bearTag._id,
            width: bearTag._props.Width,
            height: bearTag._props.Height,
            weight: bearTag._props.Weight,
            baseValue: this.credits[bearTag._id],
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
        for (const [id, item] of this.dbItems.entries()) {
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
            if (!defaultId && this.items[item.id]._props.Slots.length > 0) {
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
            preset.normalized_name = this.normalizeName(this.getTranslation(preset.name));
        }

        // make sure normalized names are unique
        Object.values(this.presetsData).forEach((preset, i, presets) => {
            if (i === 0) {
                return;
            }
            const dupes = presets.filter((p, ii) => {
                return (p.normalized_name === preset.normalized_name);
            });
            if (dupes.length === 1) {
                return;
            }
            const position = dupes.indexOf(preset) + 1;
            if (position === 1) {
                return;
            }
            preset.normalized_name += `-${position}`;
        });

        const queries = [];
        const regnerateImages = [];
        for (const [id, item] of this.dbItems.entries()) {
            if (!item.types.includes('preset')) {
                continue;
            }
            if (item.types.includes('disabled')) {
                if (!remoteData.hasPrices(id)) {
                    await query('DELETE FROM item_data WHERE id = ?', [id]);
                    await query('DELETE FROM types WHERE item_id = ?', [id]);
                    this.logger.log(`Deleted unused preset ${item.name} ${id}`);
                }
                continue;
            }
            const p = this.presetsData[id];
            if (!p) {
                this.logger.warn(`Preset ${item.name} ${id} is no longer valid; disabling`);
                queries.push(remoteData.addType(id, 'disabled').catch(error => {
                    this.logger.error(`Error disabling ${item.name} ${id}`);
                    this.logger.error(error);
                }));
                continue;
            }
            if (p.armorOnly) {
                continue;
            }
            if (item.short_name !== this.getTranslation(p.shortName) || item.width !== p.width || item.height !== p.height || item.properties.backgroundColor !== p.backgroundColor) {
                regnerateImages.push(p);
            }
        }

        this.logger.log('Updating presets in DB...');
        for (const presetId in this.presetsData) {
            const presetIsNewItem = !this.dbItems.has(presetId);
            const p = this.presetsData[presetId];
            queries.push(remoteData.addItem({
                id: p.id,
                name: this.getTranslation(p.name),
                short_name: this.getTranslation(p.shortName),
                normalized_name: p.normalized_name,
                width: p.width,
                height: p.height,
                properties: {backgroundColor: p.backgroundColor, items: p.items},
            }).then(() => {
                if (presetIsNewItem) {
                    this.logger.log(`${p.name} added`);
                    this.addJobSummary(`${p.name} ${presetId}`, 'Added Presets(s)');
                }    
                if (p.armorOnly) {
                    // this preset consists of only armor items
                    // shares images with base item
                    const baseItem = this.dbItems.get(p.baseId);
                    const pItem = this.dbItems.get(p.id);
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
            const localItem = this.dbItems.get(p.id);
            if (!localItem?.types.includes('preset')) {
                queries.push(remoteData.addType(p.id, 'preset').catch(error => {
                    this.logger.error(`Error inserting preset type for ${p.name} ${p.id}`);
                    this.logger.error(error);
                }));
            }
            if (localItem?.types.includes('disabled')) {
                queries.push(remoteData.removeType(p.id, 'disabled').catch(error => {
                    this.logger.error(`Error removing disabled type for ${p.name} ${p.id}`);
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
                this.addJobSummary(`${this.getTranslation(item.name)} ${item.id}`, 'Regenerated Images');
            }
            this.logger.succeed('Finished regenerating images');
        }

        // make sure we don't include any disabled presets
        this.presetsData = Object.keys(this.presetsData).reduce((all, presetId) => {
            //console.log(`${presetId} ${this.dbItems.has(presetId)} ${this.dbItems.get(presetId)?.types.includes('disabled')}`);
            if (this.dbItems.has(presetId) && !this.dbItems.get(presetId).types?.includes('disabled')) {
                all[presetId] = this.presetsData[presetId];
            }
            return all;
        }, {});

        for (const langCode in this.translationHelper.locale) {
            for (const key in this.translationHelper.locale[langCode]) {
                if (!Object.values(this.presetsData).some(preset => preset.name === key || preset.shortName === key)) {
                    this.removeTranslation(key);
                }
            }
        }

        this.kvData.presets = this.presetsData;
        this.kvData.locale = await this.fillTranslations();
        fs.writeFileSync(path.join(import.meta.dirname, '..', this.writeFolder, `${this.kvName}.json`), JSON.stringify(this.kvData, null, 4));
        await Promise.allSettled(queries);
        presetsHelper.updatePresets(this.kvData);
        return this.kvData;
    }
}

export default UpdatePresetsJob;
