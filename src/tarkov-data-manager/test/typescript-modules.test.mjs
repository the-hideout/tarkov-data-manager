import assert from 'node:assert/strict';
import test from 'node:test';

import dogtags from '../modules/dogtags.mts';
import fixWikiName from '../modules/wiki-replacements.cts';

test('typed dogtag data preserves the faction IDs', () => {
    assert.deepEqual(dogtags.ids, {
        bear: '59f32bb586f774757e1e8442',
        usec: '59f32c3b86f77472a31742f0',
    });
});

test('typed wiki replacements preserve exact, partial, and passthrough behavior', () => {
    assert.equal(fixWikiName('MRE'), 'MRE lunch box');
    assert.equal(fixWikiName('Immobilizing splint (alu)'), 'Aluminum splint');
    assert.equal(fixWikiName('Yellow keycard barter'), 'TerraGroup Labs keycard (Yellow)');
    assert.equal(fixWikiName('Unknown item'), 'Unknown item');
    assert.equal(fixWikiName(''), '');
    assert.equal(fixWikiName(undefined), undefined);
    assert.equal(fixWikiName(null), null);
});
