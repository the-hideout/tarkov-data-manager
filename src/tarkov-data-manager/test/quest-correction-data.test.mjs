import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    loadQuestCorrectionSource,
    loadQuestCorrectionSources,
    questCorrectionSources,
} from '../modules/quest-correction-data.mjs';

const expectedDigests = {
    missingQuests: '4ef19d6b30cbe5dda3e5f9530bca3433b0aeb3ea5d5cabff9a6c4cfed0ae74ea',
    changedQuestsOriginal: 'daf59146f3f0f2707a6e6e35438ab7dc70f814670c3492b65992ea73da028ca7',
    changedQuestsGameMode: 'ebabb8b492a78239a0302822d206dd14e41f4cdd20ceb6bee08844f7c7bc7d42',
    removedQuests: '5be14dc94c3a585add58025e685f66e8b47f5c4fa570013a60472e6a007a7963',
    neededKeys: 'c48a2d1baf1502302e210e2e8fb99fec51ee7ec21da013616a15ab656af106a4',
    globalVariables: 'b8ed514624977aa629ff883ff63ac3b5390280067d8aba44bc88614f2e3bd6f6',
};

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
    }
    return value;
}

function digest(value) {
    return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

test('all approved quest correction sources parse, validate, and preserve normalized data', async () => {
    const sources = await loadQuestCorrectionSources();
    assert.deepEqual(Object.keys(sources), Object.keys(questCorrectionSources));
    for (const [sourceKey, value] of Object.entries(sources)) {
        assert.equal(digest(value), expectedDigests[sourceKey], `${sourceKey} changed normalized data`);
    }
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
