import fs from 'node:fs';
import path from 'node:path';

import { query } from './db-connection.mjs';
import tarkovData from './tarkov-data.mjs';
import TranslationHelper from './translation-helper.mjs';
import dbConnection from './db-connection.mjs';
import remoteData from './remote-data.mjs';
import normalizeName from './normalize-name.js';
import emitter from './emitter.mjs';

let items = false;
let credits = false;
let locales = false;

const defaultLogger = {
    log: console.log,
    warn: console.warn,
    error: console.error,
};

try {
    await remoteData.get();
    emitter.emit('updated', remoteData.getPresets());
} catch (error) {
    console.log('preset-data error loading presets:', error.message);
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
        let ergo = baseItem._props.Ergonomics ?? 0;
        const baseVerticalRecoil = baseItem._props.RecoilForceUp ?? 0;
        const baseHorizontalRecoil = baseItem._props.RecoilForceBack ?? 0;
        let vRecoil = baseVerticalRecoil;
        let hRecoil = baseHorizontalRecoil;
        let centerOfImpact = baseItem._props.CenterOfImpact;
        let barrelDeviationMax = 100.0;
        for (const contained of item.containsItems) {
            let partId = contained.item;
            if (typeof partId === 'object') {
                partId = partId.id;
            }
            const part = items[partId];
    
            if (!part) {
                if (logger) logger.warn(`Could not find part ${partId} of preset ${item.id}`);
                continue;
            }
            if (part._id === baseItem._id) {
                continue;
            }
    
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
            ergo += part._props.Ergonomics ?? 0;
            vRecoil += (baseVerticalRecoil * ((part._props.Recoil ?? 0) / 100));
            hRecoil += (baseHorizontalRecoil * ((part._props.Recoil ?? 0) / 100));
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
                partData.count = parseInt(part.upd.StackObjectsCount);
            }
            const existingPart = processedPreset.containsItems.find(part => part.item.id === partData.item.id);
            if (existingPart) {
                existingPart.count += partData.count;
            } else {
                processedPreset.containsItems.push(partData);
            }
        }
        if (processedPreset.containsItems.length === 1) {
            /*const message = `Skipping empty preset for ${t.getTranslation(processedPreset.name)}`;
            if (logger) {
                logger.warn(message);
            } else {
                defaultLogger.warn(message);
            }*/
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
            processedPreset.width = itemPresetData.width;
            processedPreset.height = itemPresetData.height;
            processedPreset.weight = itemPresetData.weight;
            processedPreset.baseValue = itemPresetData.baseValue;//credits[baseItem._id];
            processedPreset.ergonomics = itemPresetData.ergonomics;
            processedPreset.verticalRecoil = itemPresetData.verticalRecoil;
            processedPreset.horizontalRecoil = itemPresetData.horizontalRecoil;
            processedPreset.moa = itemPresetData.moa;
        }
        return {preset: processedPreset, locale: await t.fillTranslations()};
    },
    validateNormalizedName: (preset, attempt = 1) => {
        let normal = preset.normalized_name;
        if (attempt > 1) {
            normal += `-${attempt}`;
        }
        const matchedPreset = Object.values(remoteData.getPresets()).find(p => p.normalized_name === normal);
        if (matchedPreset) {
            return presetData.validateNormalizedName(preset, attempt + 1);
        }
        if (attempt > 1) {
            preset.normalized_name = normal;
        }
    },
    getNextPresetId: async () => {
        const idPrefix = '707265736574';
        const dbPresets = await presetData.getDatabasePresets();
        let presetNum = 0;
        let id;
        while (true) {
            id = `${idPrefix}${presetNum.toString(16).padStart(12, '0')}`;
            if (!dbPresets[id]) {
                break;
            }
            presetNum++;
        }
        return id;
    },
    addJsonPreset: async (json, logger) => {
        const items = json.items ?? json._items;
        const existingPreset = presetData.findPreset(items);
        if (existingPreset) {
            return Promise.reject(new Error(`Specified preset already exists as ${existingPreset.id}`));
        }
        if (!locales) {
            locales = await tarkovData.locales();
        }

        const id = await presetData.getNextPresetId();

        let appendName = 'Stripped';
        const slotNames = [
            'mod_scope',
            'mod_muzzle_001',
            'mod_muzzle_000',
            'mod_muzzle',
            'mod_stock',
            'mod_magazine',
            'mod_handguard',
            'mod_pistol_grip',
            'mod_equipment',
            'mod_equipment_001',
            'mod_equipment_000',
        ];
        slotLoop: for (const slotName of slotNames) {
            for (let i = items.length - 1; i > -1; i--) {
                const part = items[i];
                if (part.slotId === slotName) {
                    appendName = `${part._tpl} ShortName`;
                    break slotLoop;
                }
            }
        }
        await dbConnection.query(`
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
            properties: {
                backgroundColor: processedPreset.preset.backgroundColor,
                items: processedPreset.preset.items,
                weight: processedPreset.preset.weight,
                bsgCategoryId: processedPreset.preset.bsgCategoryId,
                noFlea: processedPreset.preset.noFlea,
                default: processedPreset.preset.default,
                ergonomics: processedPreset.preset.ergonomics,
                verticalRecoil: processedPreset.preset.verticalRecoil,
                horizontalRecoil: processedPreset.preset.horizontalRecoil,
                moa: processedPreset.preset.moa,
                armorOnly: processedPreset.preset.armorOnly,
                baseValue: processedPreset.preset.baseValue,
            },
            types: ['preset'],
        });

        await presetData.savePresetLocalizations(processedPreset.locale);

        presetData.updatedPresets();
        
        return remoteData.getPresets()[id];
    },
    savePresetLocalizations: async (localizations) => {
        for (const langCode in localizations) {
            const insertPlaceholders = [];
            const insertValues = [];
            for (const translationKey in localizations[langCode]) {
                if (!localizations[langCode][translationKey]) {
                    continue;
                }
                insertValues.push(langCode, translationKey, localizations[langCode][translationKey]);
                insertPlaceholders.push('(?, ?, ?)');
            }
            await query(`
                INSERT INTO preset_locale (locale, \`key\`, localization) 
                VALUES ${insertPlaceholders.join(', ')}
                ON DUPLICATE KEY UPDATE localization=VALUES(localization)`,
                insertValues,
            );
        }
    },
    getDatabasePresets: async () => {
        const results = await dbConnection.query('SELECT * from manual_preset');
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
    getAllPresets: async () => {
        const [
            allPresets,
            dbPresets,
        ] = await Promise.all([
            presetData.getGamePresets(),
            presetData.getDatabasePresets(),
        ]);
        for (const p of Object.values(dbPresets)) {
            allPresets[p._id] = p;
        }
        return allPresets;
    },
    updatedPresets: () => {
        emitter.emit('presetsUpdated', remoteData.getPresets());
    },
    getPresetItems: async (forceRefresh = false) => {
        await remoteData.get(forceRefresh);
        return remoteData.getPresets();
    },
    flatItemsToContainedItems: (items, blacklist = []) => {
        if (typeof blacklist === 'string') {
            blacklist = [blacklist];
        }
        return items.reduce((all, current) => {
            if (blacklist.includes(current._tpl)) {
                return all;
            }
            const existing = all.find(c => c.item === current._tpl);
            const amount = parseInt(current.upd?.StackObjectsCount ?? 1);
            if (existing) {
                existing.count += amount;
            } else {
                all.push({
                    item: current._tpl,
                    count: amount,
                    attributes: [],
                });
            }
            return all;
        }, [])
    },
    itemsMatch: (itemsA, itemsB) => {
        if (itemsA.length !== itemsB.length) {
            return false;
        }
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
        // for every part in A, there is a matching part in B
        return itemsA.every(partA => {
            if (!itemsB.some(partB => partB._tpl === partA._tpl)) {
                // B has no part of the same item
                return false;
            }
            const partPathA = getPartPath(partA, itemsA);
            return itemsB.some(partB => {
                if (partA._tpl !== partB._tpl) {
                    // this isn't the same item
                    return false;
                }
                const partPathB = getPartPath(partB, itemsB);
                if (partPathA.length !== partPathB.length) {
                    // there are more parts in one path
                    return false;
                }
                for (let i = 0; i < partPathA.length; i++) {
                    const pathItemA = partPathA[i];
                    const pathItemB = partPathB[i];
                    if (pathItemB._tpl !== pathItemA._tpl) {
                        // the items at this step of the path don't match
                        return false;
                    }
                    if (pathItemB.slotId !== pathItemA.slotId) {
                        // the items are attached to different slots
                        return false;
                    }
                    if (pathItemB.parentId && pathItemB.upd?.StackObjectsCount !== pathItemA.upd?.StackObjectsCount) {
                        // there are a differnt number of items (ammmo)
                        return false;
                    }
                    if (pathItemA.location !== pathItemB.location) {
                        // the item is in a different location (ammo)
                        return false;
                    }
                }
                return true;
            });
        });
    },
    findPreset: (items) => {
        const allPresets = remoteData.getPresets();
        for (const preset of Object.values(allPresets)) {
            if (presetData.itemsMatch(items, preset.properties.items)) {
                return preset;
            }
        }
        console.log(items);
        return false;
    },
    presetUsed: async (id) => {
        const result = await dbConnection.query(`UPDATE manual_preset SET last_used = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
        return result.affectedRows > 0;
    },
    deletePreset: async (id) => {
        const presets = remoteData.getPresets();
        if (!presets[id]) {
            return Promise.reject(new Error(`No preset found with id ${id}`));
        }
        const gamePresets = await presetData.getGamePresets();
        if (gamePresets[id]) {
            return Promise.reject(new Error(`Cannot delete game preset ${id}`));
        }
        await Promise.all([
            dbConnection.query(`DELETE FROM manual_preset WHERE id = ?`, [id]),
            dbConnection.query(`DELETE FROM preset_locale WHERE \`key\` = ?`, [`${id} Name`]),
            dbConnection.query(`DELETE FROM preset_locale WHERE \`key\` = ?`, [`${id} ShortName`]),
            dbConnection.query(`DELETE FROM price_data WHERE item_id = ?`, [id]),
            dbConnection.query(`DELETE FROM price_archive WHERE item_id = ?`, [id]),
            dbConnection.query('DELETE FROM price_historical WHERE item_id = ?', [id]),
            remoteData.removeItem(id),
        ]);
        emitter.emit('presetsUpdated', presets);
    },
    mergePreset: async (sourceId, targetId) => {
        const presets = remoteData.getPresets();
        if (!presets[sourceId]) {
            return Promise.reject(new Error(`No preset found with id ${sourceId}`));
        }
        if (!presets[targetId]) {
            return Promise.reject(new Error(`No preset found with id ${targetId}`));
        }
        const gamePresets = await presetData.getGamePresets();
        if (gamePresets[sourceId]) {
            return Promise.reject(new Error(`Cannot merge game preset ${sourceId}`));
        }
        await Promise.all([
            dbConnection.query(`UPDATE price_data SET item_id = ? WHERE item_id = ?`, [targetId, sourceId]),
            dbConnection.query(`UPDATE IGNORE price_archive SET item_id = ? WHERE item_id = ?`, [targetId, sourceId]),
            dbConnection.query(`UPDATE IGNORE price_historical SET item_id = ? WHERE item_id = ?`, [targetId, sourceId]),
            dbConnection.query(`UPDATE IGNORE trader_offers SET item_id = ? WHERE item_id = ?`, [targetId, sourceId]),
            dbConnection.query(`DELETE FROM manual_preset WHERE id = ?`, [sourceId]),
            dbConnection.query(`DELETE FROM preset_locale WHERE \`key\` = ?`, [`${sourceId} Name`]),
            dbConnection.query(`DELETE FROM preset_locale WHERE \`key\` = ?`, [`${sourceId} ShortName`]),
            remoteData.removeItem(sourceId),
        ]);
        emitter.emit('presetsUpdated', presets);
    },
    changePresetId: async (sourceId, targetId) => {
        const presets = remoteData.getPresets();
        if (!presets[sourceId]) {
            return Promise.reject(new Error(`No preset found with id ${sourceId}`));
        }
        if (presets[targetId]) {
            return Promise.reject(new Error(`Preset found with id ${targetId} already exists`));
        }
        const gamePresets = await presetData.getGamePresets();
        if (gamePresets[sourceId]) {
            return Promise.reject(new Error(`Cannot change id for game preset ${sourceId}`));
        }
        
        await Promise.all([
            dbConnection.query(`UPDATE IGNORE item_data SET id = ? WHERE id = ?`, [targetId, sourceId]),
            dbConnection.query(`UPDATE IGNORE manual_preset SET id = ? WHERE id = ?`, [targetId, sourceId]),
            dbConnection.query(`UPDATE IGNORE preset_locale SET \`key\` = ? WHERE \`key\` = ?`, [`${targetId} Name`, `${sourceId} Name`]),
            dbConnection.query(`UPDATE IGNORE preset_locale SET \`key\` = ? WHERE \`key\` = ?`, [`${targetId} ShortName`, `${sourceId} ShortName`]),
            dbConnection.query(`UPDATE IGNORE price_data SET item_id = ? WHERE item_id = ?`, [targetId, sourceId]),
            dbConnection.query(`UPDATE IGNORE price_archive SET item_id = ? WHERE item_id = ?`, [targetId, sourceId]),
            dbConnection.query(`UPDATE IGNORE price_historical SET item_id = ? WHERE item_id = ?`, [targetId, sourceId]),
            dbConnection.query(`UPDATE IGNORE trader_offers SET item_id = ? WHERE item_id = ?`, [targetId, sourceId]),
        ]);
        const allItems = await remoteData.get();
        const item = allItems.get(sourceId);
        item.id = targetId;
        allItems.set(item.id, item);
        allItems.delete(sourceId);
        emitter.emit('presetsUpdated', presets);
        return item;
    },
};

export const { getPresetProperties, init: initPresetData, addJsonPreset } = presetData;

export default presetData;