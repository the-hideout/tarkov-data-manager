import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

import tarkovData from './tarkov-data.mjs';
import TranslationHelper from './translation-helper.mjs';
import { query } from './db-connection.mjs';
import remoteData from './remote-data.mjs';
import normalizeName from './normalize-name.js';

let items = false;
let credits = false;
let locales = false;

export const presets = {
    presets: {},
    locale: {},
};

const emitter = new EventEmitter();

const defaultLogger = {
    log: console.log,
    warn: console.warn,
    error: console.error,
};

try {
    const fileContents = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'cache', 'presets.json')));
    presets.presets = fileContents.presets;
    presets.locale = fileContents.locale;
    emitter.emit('updated', presets);
} catch (error) {
    console.log('preset-data error reading presets.json:', error.message);
}

const presetData = {
    init: (bsgItemsData, creditsData, localesData) => {
        items = bsgItemsData;
        credits = creditsData;
        locales = localesData ?? locales;
    },
    getPresetProperties: async (item, logger = false) => {
        if(!items){
            items = await tarkovData.items();
        }
        if (!credits) {
            credits = await tarkovData.credits();
        }
    
        const directions = [
            'Left',
            'Right',
            'Up',
            'Down',
        ];
    
        const softSizes = {Left: 0, Right: 0, Up: 0, Down: 0};
        const hardSizes = {Left: 0, Right: 0, Up: 0, Down: 0};
        const baseItem = item.baseId ? items[item.baseId] : items[item.id];
        if (!baseItem) {
            if (logger) logger.warn(`Could not find a base item to calculate size for ${item.id}`);
            return false;
        }
    
        let weight = baseItem._props.Weight;
        let baseValue = credits[baseItem._id];
        let ergo = baseItem._props.Ergonomics;
        const baseVerticalRecoil = baseItem._props.RecoilForceUp;
        const baseHorizontalRecoil = baseItem._props.RecoilForceBack;
        let vRecoil = baseVerticalRecoil;
        let hRecoil = baseHorizontalRecoil;
        let centerOfImpact = baseItem._props.CenterOfImpact;
        let barrelDeviationMax = 100.0;
        for (const contained of item.containsItems) {
            let partId = contained.item;
            if (typeof partId === 'object') partId = partId.id;
            const part = items[partId];
    
            if(!part){
                if (logger) logger.warn(`Could not find part ${partId} of preset ${item.id}`);
                continue;
            }
            if (part._id === baseItem._id) continue;
    
            for (const dir of directions) {
                if (part._props.ExtraSizeForceAdd) {
                    hardSizes[dir] += part._props[`ExtraSize${dir}`];
                } else {
                    if (part._props[`ExtraSize${dir}`] > softSizes[dir]) {
                        softSizes[dir] = part._props[`ExtraSize${dir}`];
                    }
                }
            }
            weight += (part._props.Weight * contained.count);
            if (credits[part._id]) {
                baseValue += (credits[part._id] * contained.count);
            } else {
                if (logger) logger.warn(`Could not find base value for part ${partId} of preset ${item.id}`);
            }
            ergo += part._props.Ergonomics;
            vRecoil += (baseVerticalRecoil * (part._props.Recoil / 100));
            hRecoil += (baseHorizontalRecoil * (part._props.Recoil / 100));
            if (part._props.DeviationMax) {
                barrelDeviationMax = part._props.DeviationMax;
            }
            if (!isNaN(part._props.CenterOfImpact)) {
                centerOfImpact += parseFloat(part._props.CenterOfImpact);
            }
    
            // add base value for built-in armor pieces
            part._props.Slots?.forEach(slot => {
                slot._props?.filters?.forEach(filter => {
                    if (!filter.Plate || !filter.locked) {
                        return;
                    }
                    baseValue += credits[filter.Plate];
                });
            });
        }
    
        const getBarrelDeviation = (durability = 100.0) => {
            const deviationCurve = baseItem._props.DeviationCurve;
            const num = 2.0 * deviationCurve;
            const num2 = ((100.0 - num === 0) ? durability / num : (((deviationCurve * -1) + Math.sqrt(((num * -1) + 100.0) * durability + deviationCurve)) / ((num * -1) + 100.0)));
            const num3 = 1.0 - num2;
            return num3 * num3 * barrelDeviationMax + 2.0 * num2 * num3 * deviationCurve + num2 * num2;
        };
        const moa = centerOfImpact * getBarrelDeviation() * 100.0 / 2.9089;
    
        return {
            width: baseItem._props.Width + softSizes.Left + softSizes.Right + hardSizes.Left + hardSizes.Right,
            height: baseItem._props.Height + softSizes.Up + softSizes.Down + hardSizes.Up + hardSizes.Down,
            weight : Math.round(weight * 1000) / 1000,
            baseValue: baseValue,
            ergonomics: ergo,
            verticalRecoil: Math.round(vRecoil),
            horizontalRecoil: Math.round(hRecoil),
            moa: Math.round(moa * 100) / 100,
        };
    },
    processGamePreset: async (preset, logger) => {
        if(!items){
            items = await tarkovData.items();
        }
        if (!credits) {
            credits = await tarkovData.credits();
        }
        if (!locales) {
            locales = await tarkovData.locales();
        }

        const t = new TranslationHelper({locales, logger});

        const baseItem = items[preset._items[0]._tpl];
        if (!baseItem) {
            return Promise.reject(new Error(`Invalid base item for preset ${preset._name} ${presetId}`));
        }
        const firstItem = {
            id: baseItem._id,
            name: t.getTranslation([`${baseItem._id} Name`])
        };
        const presetId = preset.id ?? preset._id;
        const processedPreset = {
            id: presetId,
            name: t.addTranslation(`${presetId} Name`, (lang, langCode) => {
                let baseName = lang[`${firstItem.id} Name`];
                if (!baseName && langCode !== 'en') {
                    baseName = locales.en[`${firstItem.id} Name`];
                }
                if (!preset._changeWeaponName) {
                    return baseName;
                }
                const append = preset.appendName || presetId;
                if (lang[append]) {
                    return baseName + ' ' + lang[append];
                }
                if (langCode !== 'en'  && locales.en[append]) {
                    return baseName + ' ' + locales.en[append];
                }
                return baseName;
            }),
            shortName: t.addTranslation(`${presetId} ShortName`, (lang, langCode) => {
                let baseName = lang[`${firstItem.id} ShortName`];
                if (!baseName && langCode !== 'en') {
                    baseName = locales.en[`${firstItem.id} ShortName`];
                }
                if (!preset._changeWeaponName) {
                    return baseName;
                }
                const append = preset.appendName || presetId;
                if (lang[append]) {
                    return baseName + ' ' + lang[append];
                }
                if (langCode !== 'en'  && locales.en[append]) {
                    return baseName + ' ' + locales.en[append];
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
        for (let i = 1; i < processedPreset.items.length; i++) {
            const part = processedPreset.items[i];
            if (!items[part._tpl]._props.CanSellOnRagfair) {
                processedPreset.noFlea = true;
            }
            if (items[part._tpl]._parent !== '644120aa86ffbe10ee032b6f') {
                processedPreset.armorOnly = false;
            }
            const partData = {
                item: {
                    id: part._tpl,
                    name: t.getTranslation([`${part._tpl} Name`]),
                },
                count: 1
            };
            if (part.upd && part.upd.StackObjectsCount) {
                partData.count = part.upd.StackObjectsCount;
            }
            const existingPart = processedPreset.containsItems.find(part => part.item.id === partData.item.id);
            if (existingPart) {
                existingPart.count += partData.count;
            } else {
                processedPreset.containsItems.push(partData);
            }
        }
        if (processedPreset.containsItems.length === 1) {
            const message = `Skipping empty preset for ${t.getTranslation(processedPreset.name)}`;
            if (logger) {
                logger.warn(message);
            } else {
                defaultLogger.warn(message);
            }
            const dbItems = await remoteData.get();
            const dbItem = dbItems.get(presetId);
            if (dbItem && !dbItem.types.includes('disabled')) {
                await remoteData.addType(presetId, 'disabled');
            }
            return Promise.reject(new Error(`Cannot create empty preset ${t.getTranslation(processedPreset.name)} ${processedPreset.id}`));
        }
        processedPreset.normalized_name = normalizeName(t.getTranslation(processedPreset.name));
        presetData.validateNormalizedName(processedPreset);
        let itemPresetData = await presetData.getPresetProperties(processedPreset, logger);
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
        return {preset: processedPreset, locale: await t.fillTranslations()};
    },
    validateNormalizedName: (preset, attempt = 1) => {
        let normal = preset.normalized_name;
        if (attempt > 1) {
            normal += `-${attempt}`;
        }
        const matchedPreset = Object.values(presets).find(p => p.normalized_name === normal);
        if (matchedPreset) {
            return this.validateNormalizedName(preset, attempt + 1);
        }
        if (attempt > 1) {
            preset.normalized_name = normal;
        }
    },
    addJsonPreset: async (json, logger) => {
        const existingPreset = presetData.findPreset(json._items);
        if (existingPreset) {
            return Promise.reject(new Error(`Specified preset already exists as ${existingPreset.id}`));
        }
        if (!locales) {
            locales = await tarkovData.locales();
        }
        const t = new TranslationHelper({locales, logger});

        const idPrefix = '707265736574';
        const dbPresets = await presetData.getDatabasePresets();
        let presetNum = Object.keys(dbPresets).length + 1;
        let id;
        while (true) {
            id = `${idPrefix}${String(presetNum).padStart(12, '0')}`;
            if (!dbPresets[id]) {
                break;
            }
            presetNum++;
        }
        let appendName = 'Stripped';
        const slotNames = [
            'mod_scope',
            'mod_muzzle',
            'mod_stock',
            'mod_magazine',
            'mod_handguard',
            'mod_pistol_grip',
            'mod_equipment',
        ];
        const items = json.items ?? json._items;
        for (const slotName of slotNames) {
            for (let i = items.length - 1; i > -1; i--) {
                const part = items[i];
                if (part.slotId === slotName) {
                    appendName = `${part._tpl} ShortName`;
                    break;
                }
            }
        }
        await query(`
            INSERT INTO manual_preset 
                (id, append_name, items)
            VALUES
                (?, ?, ?)
        `, [id, appendName, JSON.stringify(items)]);
        const processedPreset = await presetData.processGamePreset({
            _id: id,
            appendName,
            _changeWeaponName: true,
            _items: items,
        });
        await remoteData.addItem({
            id,
            name: processedPreset.locale.en[processedPreset.preset.name],
            short_name: processedPreset.locale.en[processedPreset.preset.shortName],
            normalized_name: processedPreset.preset.normalized_name,
            width: processedPreset.preset.width,
            height: processedPreset.preset.height,
            properties: {backgroundColor: processedPreset.preset.backgroundColor, items: processedPreset.preset.items},
        });
        await remoteData.addType(processedPreset.preset.id, 'preset');

        presetData.addPreset(processedPreset);
        
        return processedPreset;
    },
    getDatabasePresets: async () => {
        const results = await query('SELECT * from manual_preset');
        const dbPresets = {};
        results.forEach(p => {
            dbPresets[p.id] =  {
                _id: p.id,
                appendName: p.append_name,
                _changeWeaponName: true,
                _items: p.items,
            };
        });
        return dbPresets;
    },
    getJsonPresets: () => {
        const jsonPresets = {};
        JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'manual_presets.json'))).forEach(p => {
            if (!p._id.match(/^[a-zA-Z0-9]{23}[a-f0-9]$/)) {
                console.error(`${p._id} is not a valid id`);
                return;
            }
            p._changeWeaponName = true;
            jsonPresets[p._id] = p;
        });
        return jsonPresets;
    },
    getGamePresets: async () => {
        return tarkovData.globals().then(glob => glob['ItemPresets']);
    },
    updatePresets: (updatedPresets) => {
        for (const id in updatedPresets.presets) {
            presets.presets[id] = updatedPresets.presets[id];
        }
        presets.locale = updatedPresets.locale;
        for (const id in presets.presets) {
            if (updatedPresets.presets[id]) {
                continue;
            }
            presets.presets[id] = undefined;
        }
        presets.locale = updatedPresets.locale;
        emitter.emit('updated', presets);
    },
    addPreset: (processedPreset) => {
        presets.presets[processedPreset.preset.id] = processedPreset.preset;
        for (const langCode in processedPreset.locale) {
            if (!presets.locale[langCode]) {
                presets.locale[langCode] = {};
            }
            for (const key in processedPreset.locale[langCode]) {
                presets.locale[langCode][key] = processedPreset.locale[langCode][key];
            }
        }
        emitter.emit('updated', presets);
    },
    findPreset: (items) => {
        const getPartPath = (part, parts) => {
            const getParent = (part1) => {
                return parts.find(part2 => part1.parentId === part2._id);
            };
            const tpls = [part];
            let current = getParent(part);
            while (current) {
                tpls.push(current);
                current = getParent(current);
            }
            return tpls;
        };
        for (const preset of Object.values(presets.presets)) {
            if (preset.items.length !== items.length) {
                continue;
            }
            const partsMatch = preset.items.every(presetPart => {
                if (!items.some(p => p._tpl === presetPart._tpl)) {
                    return false;
                }
                const presetPartPath = getPartPath(presetPart, preset.items);
                return items.some(itemPart => {
                    if (itemPart._tpl !== presetPart._tpl) {
                        return false;
                    }
                    const itemPartPath = getPartPath(itemPart, items);
                    if (presetPartPath.length !== itemPartPath.length) {
                        return false;
                    }
                    for (let i = 0; i < presetPartPath.length; i++) {
                        const presetPathItem = presetPartPath[i];
                        const itemPathItem = itemPartPath[i];
                        if (presetPathItem._tpl !== itemPathItem._tpl) {
                            return false;
                        }
                        if (presetPathItem.slotId !== itemPathItem.slotId) {
                            return false;
                        }
                        if (presetPathItem.parentId && presetPathItem.upd?.StackObjectsCount !== itemPathItem.upd?.StackObjectsCount) {
                            return false;
                        }
                    }
                    return true;
                });
            });
            if (!partsMatch) {
                continue;
            }
            return preset;
        }
        return false;
    },
    presetUsed: async (id) => {
        const result = await query(`UPDATE manual_preset SET last_used = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
        return result.affectedRows > 0;
    },
    presets,
    on: (event, listener) => {
        return emitter.on(event, listener);
    },
    off: (event, listener) => {
        return emitter.off(event, listener);
    },
    once: (event, listener) => {
        return emitter.once(event, listener);
    },
};

export const { getPresetProperties, init: initPresetData, addJsonPreset } = presetData;

export default presetData;