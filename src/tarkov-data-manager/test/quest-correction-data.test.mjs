import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    loadQuestCorrectionSource,
    loadQuestCorrectionSources,
    questCorrectionSources,
} from '../modules/quest-correction-data.mjs';

test('all approved quest correction sources parse and validate', async () => {
    const sources = await loadQuestCorrectionSources();
    assert.deepEqual(Object.keys(sources), Object.keys(questCorrectionSources));
});

test('JSON5 comments and trailing commas are accepted', async t => {
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'quest-json5-'));
    t.after(() => fs.rm(dataDirectory, {recursive: true, force: true}));
    await fs.writeFile(path.join(dataDirectory, questCorrectionSources.removedQuests), `{
        // JSON5 is intentionally supported for human-maintained corrections.
        questId: 'Quest name',
    }`);
    assert.deepEqual(await loadQuestCorrectionSource('removedQuests', {dataDirectory}), {questId: 'Quest name'});
});

test('parse errors identify the source file', async t => {
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'quest-json5-'));
    t.after(() => fs.rm(dataDirectory, {recursive: true, force: true}));
    const filename = questCorrectionSources.removedQuests;
    await fs.writeFile(path.join(dataDirectory, filename), '{broken:');
    await assert.rejects(
        loadQuestCorrectionSource('removedQuests', {dataDirectory}),
        error => error.message.includes(filename),
    );
});

test('runtime validation rejects an invalid source shape', async t => {
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'quest-json5-'));
    t.after(() => fs.rm(dataDirectory, {recursive: true, force: true}));
    await fs.writeFile(path.join(dataDirectory, questCorrectionSources.removedQuests), '[]');
    await assert.rejects(
        loadQuestCorrectionSource('removedQuests', {dataDirectory}),
        /must be an object/,
    );
});
