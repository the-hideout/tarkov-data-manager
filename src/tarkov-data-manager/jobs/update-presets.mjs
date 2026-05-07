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
        [this.gamePresets, this.items, this.credits, this.dbItems] = await Promise.all([
            presetsHelper.getGamePresets(),
            tarkovData.items(),
            tarkovData.credits(),
            remoteData.get(),
        ]);

        presetsHelper.init(this.items, this.credits, this.locales);

        this.dbPresets = await presetsHelper.getDatabasePresets();

        const mergeCounts = {};
        const mergedPresets = [];
        const mergePromises = [];
        const dbPresetsArray = Object.values(this.dbPresets).sort((a, b) => {
            return a._id - b._id;
        });
        for (let i = 0; i < dbPresetsArray.length; i++) {
            const dbPreset = dbPresetsArray[i];
            // first, merge db presets into duplicate game presets
            for (const gamePreset of Object.values(this.gamePresets)) {
                const gamePresetItem = this.dbItems.get(gamePreset._id);
                if (!gamePresetItem) {
                    continue;
                }
                if (!presetsHelper.itemsMatch(dbPreset._items, this.removeSoftArmor(gamePreset._items))) {
                    continue;
                }
                mergeCounts[gamePreset._id] ??= 0;
                mergeCounts[gamePreset._id]++;
                mergedPresets.push(dbPreset._id);
                mergePromises.push(presetsHelper.mergePreset(dbPreset._id, gamePreset._id));
                break;
            }
            // next, find other duplicate presets and merge into this preset
            // we compare working back from the end
            for (let ii = dbPresetsArray.length - 1; ii > i; ii--) {
                if (mergedPresets.includes(dbPreset._id)) {
                    // this preset was already merged into another preset
                    break;
                }
                const dbPresetCompare = dbPresetsArray[ii];
                if (mergedPresets.includes(dbPresetCompare._id)) {
                    // comparison already merged into another preset
                    continue;
                }
                if (!presetsHelper.itemsMatch(dbPreset._items, dbPresetCompare._items)) {
                    continue;
                }
                mergeCounts[dbPreset._id] ??= 0;
                mergeCounts[dbPreset._id]++;
                mergedPresets.push(dbPresetCompare._id);
                mergePromises.push(presetsHelper.mergePreset(dbPresetCompare._id, dbPreset._id));
            }
        }
        await Promise.all(mergePromises);
        for (const id in mergeCounts) {
            const item = this.dbItems.get(id);
            this.addJobSummary(`${item.name} ${item.id}: ${mergeCounts[id]}`, 'Merged Identical Presets');
        }

        this.presets = {};

        for (const p of (Object.values(this.gamePresets))) {
            this.presets[p._id] = p;
        }

        for (const p of Object.values(this.dbPresets)) {
            if (mergedPresets.includes(p._id)) {
                continue;
            }
            /*if (!presetsHelper.isNormalPresetId(p._id)) {
                const newId = await presetsHelper.getNextPresetId();
                await presetsHelper.changePresetId(p._id, newId);
                this.logger.log(`Changed preset id ${p._id} to ${newId}`);
                this.addJobSummary(`${p._id} -> ${newId}`, 'Changed Preset Id');
                p._id = newId;
            }*/
            this.presets[p._id] = p;
        }

        await this.x17PresetCheck();

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
        const usecTag = this.items['59f32c3b86f77472a31742f0'];
        const dogtagPresetId = this.dbItems.values().find(i => i.types.includes('preset') && i.properties.items?.some(part => part._tpl === bearTag._id) && i.properties.items?.some(part => part._tpl === usecTag._id))?.id ?? await presetsHelper.getNextPresetId();
        const getDogTagName = lang => {
            return lang[`${bearTag._id} Name`].replace(lang['59f32bb586f774757e1e8442 ShortName'], '').trim().replace(/^\p{Ll}/gu, substr => {
                return substr.toUpperCase();
            });
        };
        const dogtagPreset = {
            id: dogtagPresetId,
            name: this.addTranslation(`${dogtagPresetId} Name`, getDogTagName),
            shortName: this.addTranslation(`${dogtagPresetId} ShortName`, getDogTagName),
            normalized_name: this.normalizeName(this.getTranslation(`${dogtagPresetId} Name`)),
            baseId: bearTag._id,
            width: bearTag._props.Width,
            height: bearTag._props.Height,
            weight: bearTag._props.Weight,
            baseValue: this.credits[bearTag._id],
            backgroundColor: bearTag._props.BackgroundColor,
            bsgCategoryId: bearTag._parent,
            types: ['preset', 'no-flea'],
            default: false,
            containsItems: [],
            items: [],
        };
        // get the dogtag case item and add all items that can fit inside
        const dogtagCase = this.items['5c093e3486f77430cb02e593'];
        for (const id of dogtagCase._props.Grids[0]._props.filters[0].Filter) {
            const tagItem = this.dbItems.get(id);
            if (!tagItem) {
                continue;
            }
            if (tagItem.types.includes('quest') || tagItem.types.includes('disabled')) {
                continue;
            }
            if (dogtagPreset.items.some(i => i._tpl === id)) {
                continue;
            }
            dogtagPreset.items.push({
                _id: (dogtagPreset.items.length+1).toString().padStart(24, '0'),
                _tpl: id,
            });
        }
        dogtagPreset.containsItems = dogtagPreset.items.map(i => {
            return {
                item: {
                    id: i._tpl,
                },
                count: 1,
            };
        });
        
        this.presetsData[dogtagPresetId] = dogtagPreset;

        // check for missing default presets
        for (const [id, item] of this.dbItems.entries()) {
            if (!item.types.includes('gun') || item.types.includes('disabled')) {
                continue;
            }
            
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

        // check for orphaned disabled presets
        const removedItems = [];
        for (const [id, item] of this.dbItems.entries()) {
            if (!item.types.includes('preset') || !item.types.includes('disabled')) {
                // not a preset or not disabled
                continue;
            }
            if (this.presets[id]) {
                // preset still exists
                continue;
            }
            removedItems.push(remoteData.removeItem(id));
        }
        await Promise.all(removedItems);

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
        const presetsArray = Object.values(this.presetsData);
        for (let i = 0; i < presetsArray.length; i++) {
            const preset = presetsArray[i];
            let dupes = 0;
            for (let ii = i + 1; i < presetsArray.length; i++) {
                const p = presetsArray[ii];
                if (p.normalized_name !== preset.normalized_name) {
                    continue;
                }
                dupes++;
                p.normalized_name += `-${(dupes + 1)}`;
            }
        }

        const queries = [];
        const regnerateImages = [];
        for (const [id, item] of this.dbItems.entries()) {
            if (!item.types.includes('preset')) {
                // item isn't a preset
                continue;
            }
            const p = this.presetsData[id];
            if (!p) {
                // item is marked as preset, but there's no preset record for it
                if (!item.types.includes('disabled')) {    
                    this.logger.warn(`Preset ${item.name} ${id} is no longer valid; disabling`);
                    //queries.push(presetsHelper.deletePreset(id));

                    queries.push(remoteData.addType(id, 'disabled'));
                }
                continue;
            }
            if (p.armorOnly) {
                // we don't have to regenerate images for armor presets
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
                properties: {
                    backgroundColor: p.backgroundColor,
                    items: p.items,
                    weight: p.weight,
                    bsgCategoryId: p.bsgCategoryId,
                    noFlea: p.noFlea,
                    default: p.default,
                    ergonomics: p.ergonomics,
                    verticalRecoil: p.verticalRecoil,
                    horizontalRecoil: p.horizontalRecoil,
                    moa: p.moa,
                    armorOnly: p.armorOnly,
                    baseValue: p.baseValue,
                },
            }).then(() => {
                if (presetIsNewItem) {
                    this.logger.log(`${this.getTranslation(p.name)} added`);
                    this.addJobSummary(`${this.getTranslation(p.name)} ${presetId}`, 'Added Presets(s)');
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
        await presetsHelper.savePresetLocalizations(this.kvData.locale);
        fs.writeFileSync(path.join(import.meta.dirname, '..', this.writeFolder, `${this.kvName}.json`), JSON.stringify(this.kvData, null, 4));
        await Promise.allSettled(queries);
        presetsHelper.updatedPresets();
        return this.kvData;
    }

    removeSoftArmor(items) {
        return items.filter(i => {
            const tempalte = this.items[i._tpl];
            return tempalte._parent !== '65649eb40bf0ed77b8044453';
        });
    }

    async x17PresetCheck() {
        const x17Id = '676176d362e0497044079f4c';
        // find existing x-17 preset in either game or db presets
        let x17Preset = Object.values(this.gamePresets).find(p => p._items[0]._tpl === x17Id) ??
                        Object.values(this.dbPresets).find(p => p._items[0]._tpl === x17Id);
        if (x17Preset) {
            // there's already an x-17 preset
            return;
        }
        // we use the SCAR-H LB preset as the base
        x17Preset = structuredClone(this.gamePresets['6193e4a46bb904059c382295']);
        x17Preset._id = await presetsHelper.getNextPresetId();
        x17Preset._encyclopedia = x17Id;
        x17Preset._name = 'X-17 Default';
        x17Preset.appendName = 'Default';
        x17Preset._changeWeaponName = true;

        // use x-17 receiver
        x17Preset._items[0]._tpl = x17Id;

        // use 16" barrel instead of 20"
        const barrel = x17Preset._items.find(i => i.slotId === 'mod_barrel');
        barrel._tpl = '6183b0711cb55961fa0fdcad'; // FN SCAR-H 7.62x51 16 inch barrel

        // magazine must be compatible with X-17
        const mag = x17Preset._items.find(i => i.slotId === 'mod_magazine');
        mag._tpl = '5a3501acc4a282000d72293a'; // AR-10 7.62x51 Magpul PMAG 20 SR-LR GEN M3 20-round magazine

        // add the preset to the db
        await presetsHelper.addJsonPreset(x17Preset);

        // add the preset to the list of presets to process
        this.presets[x17Preset._id] = x17Preset;
    }
}

export default UpdatePresetsJob;
