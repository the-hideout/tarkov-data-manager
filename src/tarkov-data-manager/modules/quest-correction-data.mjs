import fs from 'node:fs/promises';
import path from 'node:path';

import JSON5 from 'json5';

export const questCorrectionSources = Object.freeze({
    missingQuests: 'missing_quests.json5',
    changedQuestsOriginal: 'changed_quests.json5',
    changedQuestsGameMode: 'changed_quests_game_mode.json5',
    removedQuests: 'removed_quests.json5',
    neededKeys: 'needed_keys.json5',
    globalVariables: 'global_variables.json5',
});

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value, location) {
    if (!isRecord(value)) {
        throw new TypeError(`${location} must be an object`);
    }
}

function validateEntries(sourceName, value, validator) {
    assertRecord(value, sourceName);
    for (const [key, entry] of Object.entries(value)) {
        if (!key) {
            throw new TypeError(`${sourceName} contains an empty key`);
        }
        validator(entry, `${sourceName}.${key}`);
    }
}

const validators = {
    missingQuests(value, sourceName) {
        validateEntries(sourceName, value, (quest, location) => {
            assertRecord(quest, location);
            if (typeof quest.id !== 'string' || !quest.id) {
                throw new TypeError(`${location}.id must be a non-empty string`);
            }
        });
    },
    changedQuestsOriginal(value, sourceName) {
        validateEntries(sourceName, value, assertRecord);
    },
    changedQuestsGameMode(value, sourceName) {
        validateEntries(sourceName, value, (quest, location) => {
            assertRecord(quest, location);
            for (const [mode, correction] of Object.entries(quest)) {
                if (mode !== 'name') {
                    assertRecord(correction, `${location}.${mode}`);
                }
            }
        });
    },
    removedQuests(value, sourceName) {
        validateEntries(sourceName, value, (questName, location) => {
            if (typeof questName !== 'string' || !questName) {
                throw new TypeError(`${location} must be a non-empty string`);
            }
        });
    },
    neededKeys(value, sourceName) {
        validateEntries(sourceName, value, (quest, location) => {
            assertRecord(quest, location);
            const questName = quest.name ?? quest.Name;
            if (typeof questName !== 'string' || !questName) {
                throw new TypeError(`${location}.name or ${location}.Name must be a non-empty string`);
            }
        });
    },
    globalVariables(value, sourceName) {
        assertRecord(value, sourceName);
        assertRecord(value.manual, `${sourceName}.manual`);
        for (const section of ['tasks', 'traders']) {
            if (!Array.isArray(value[section])) {
                throw new TypeError(`${sourceName}.${section} must be an array`);
            }
        }
    },
};

export async function loadQuestCorrectionSource(sourceKey, options = {}) {
    const filename = questCorrectionSources[sourceKey];
    if (!filename) {
        throw new TypeError(`Unknown quest correction source: ${sourceKey}`);
    }

    const dataDirectory = options.dataDirectory ?? path.join(import.meta.dirname, '..', 'data');
    const sourcePath = path.join(dataDirectory, filename);
    let parsed;
    try {
        parsed = JSON5.parse(await fs.readFile(sourcePath, 'utf8'));
    } catch (error) {
        throw new Error(`Unable to parse quest correction source ${sourcePath}: ${error.message}`, {cause: error});
    }

    validators[sourceKey](parsed, filename);
    return parsed;
}

export async function loadQuestCorrectionSources(options = {}) {
    const entries = await Promise.all(Object.keys(questCorrectionSources).map(async sourceKey => [
        sourceKey,
        await loadQuestCorrectionSource(sourceKey, options),
    ]));
    return Object.fromEntries(entries);
}
