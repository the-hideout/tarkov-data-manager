import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const artifactRoot = path.resolve(import.meta.dirname, '..', 'build', 'app');
const entrypoint = path.join(artifactRoot, 'index.mjs');

if (!fs.existsSync(entrypoint)) {
    throw new Error('Compiled application is missing. Run the build before starting the compiled runtime.');
}

const result = spawnSync(process.execPath, [
    '--enable-source-maps',
    '--max-old-space-size=3000',
    'index.mjs',
    ...process.argv.slice(2),
], {
    cwd: artifactRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
});

if (result.error) {
    throw result.error;
}
process.exitCode = result.status ?? 1;
