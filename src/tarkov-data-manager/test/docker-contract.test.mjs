import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const applicationRoot = path.resolve(import.meta.dirname, '..');
const dockerfile = await fs.readFile(path.join(applicationRoot, 'Dockerfile'), 'utf8');
const dockerignore = await fs.readFile(path.join(applicationRoot, '.dockerignore'), 'utf8');

test('production image installs and runs only the compiled artifact', () => {
    assert.match(dockerfile, /^FROM node:24\.11\.1-slim AS base$/m);
    assert.match(dockerfile, /^FROM base AS builder$/m);
    assert.match(dockerfile, /^FROM base AS runtime$/m);
    assert.doesNotMatch(dockerfile, /\bnpm install\b/);

    const builder = dockerfile.slice(
        dockerfile.indexOf('FROM base AS builder'),
        dockerfile.indexOf('FROM base AS runtime'),
    );
    assert.match(builder, /COPY package\.json package-lock\.json \.\//);
    assert.match(builder, /RUN npm ci --no-audit --no-fund/);
    assert.match(builder, /COPY \. \./);
    assert.match(builder, /RUN npm run build/);

    const runtime = dockerfile.slice(dockerfile.indexOf('FROM base AS runtime'));
    assert.match(runtime, /ENV NODE_ENV=production/);
    assert.match(runtime, /COPY --from=builder --chown=node:node \/app\/build\/app\/ \.\//);
    assert.match(runtime, /npm ci --omit=dev --no-audit --no-fund/);
    assert.match(runtime, /chmod \+x script\/wait-for-it\.sh/);
    assert.doesNotMatch(runtime, /COPY \. \./);
    assert.doesNotMatch(runtime, /npm run start/);
    assert.match(runtime, /^USER node$/m);
    assert.match(runtime, /wait-for-it\.sh database:3306 -- node script\/wait-for-db\.mjs && exec node --enable-source-maps --max-old-space-size=3000 index\.mjs/);
});

test('Docker context excludes credentials, mutable state, and stale output', () => {
    const entries = new Set(dockerignore
        .split(/\r?\n/)
        .map(entry => entry.trim())
        .filter(entry => entry && !entry.startsWith('#')));
    const requiredEntries = [
        'node_modules',
        'build',
        '*.tsbuildinfo',
        '.env',
        '.npmrc',
        'creds.env',
        'credsbpk.env',
        '*.pem',
        'dumps',
        'cache',
        'node-logs',
        'logs',
        'settings',
        'test',
    ];
    for (const entry of requiredEntries) {
        assert.ok(entries.has(entry), `Docker context does not exclude ${entry}`);
    }
});
