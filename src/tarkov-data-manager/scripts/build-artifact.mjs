import { spawnSync } from 'node:child_process';
import { access, copyFile, cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const applicationRoot = path.resolve(import.meta.dirname, '..');
const artifactRoot = path.join(applicationRoot, 'build', 'app');
const compilerPath = path.join(applicationRoot, 'node_modules', 'typescript', 'bin', 'tsc');

try {
    await access(compilerPath);
} catch {
    throw new Error('TypeScript is not installed. Install the pinned development dependencies before building.');
}

const compileResult = spawnSync(process.execPath, [compilerPath, '--project', 'tsconfig.build.json'], {
    cwd: applicationRoot,
    stdio: 'inherit',
    windowsHide: true,
});

if (compileResult.error) {
    throw compileResult.error;
}
if (compileResult.status !== 0) {
    process.exitCode = compileResult.status ?? 1;
} else {
    const assetDirectories = [
        'data',
        'public',
        'translations',
    ];
    const assetFiles = [
        '.node-version',
        'config.env',
        'old-names.json',
        'old-shortnames.json',
        'package.json',
        'package-lock.json',
    ];
    const mutableDirectories = [
        'cache',
        'dumps',
        'logs',
        'node-logs',
        'settings',
    ];

    for (const directory of assetDirectories) {
        await cp(path.join(applicationRoot, directory), path.join(artifactRoot, directory), {
            recursive: true,
            force: true,
        });
    }
    for (const filename of assetFiles) {
        await copyFile(path.join(applicationRoot, filename), path.join(artifactRoot, filename));
    }

    await mkdir(path.join(artifactRoot, 'script'), {recursive: true});
    await copyFile(
        path.join(applicationRoot, 'script', 'wait-for-it.sh'),
        path.join(artifactRoot, 'script', 'wait-for-it.sh'),
    );

    for (const directory of mutableDirectories) {
        await mkdir(path.join(artifactRoot, directory), {recursive: true});
    }

    await writeFile(path.join(artifactRoot, 'build-manifest.json'), `${JSON.stringify({
        schemaVersion: 'tarkov-data-manager/build-artifact/v1',
        entrypoint: 'index.mjs',
        workingDirectory: '.',
        jobDirectory: 'jobs',
        sourceMaps: true,
    }, null, 2)}\n`);
}
