import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const applicationRoot = path.resolve(import.meta.dirname, '..');
const artifactRoot = path.join(applicationRoot, 'build', 'app');
const buildScript = path.join(applicationRoot, 'scripts', 'build-artifact.mjs');
const serverDirectories = ['jobs', 'modules', 'script', 'scripts'];
const assetDirectories = ['data', 'public', 'translations'];
const mutableDirectories = ['cache', 'dumps', 'logs', 'node-logs', 'settings'];
const singletonAssets = [
    '.node-version',
    'config.env',
    'old-names.json',
    'old-shortnames.json',
    'package.json',
    'package-lock.json',
    path.join('script', 'wait-for-it.sh'),
];
const sourceExtensionMap = new Map([
    ['.cts', '.cjs'],
    ['.mts', '.mjs'],
    ['.ts', '.js'],
    ['.cjs', '.cjs'],
    ['.mjs', '.mjs'],
    ['.js', '.js'],
]);

const toPosix = filename => filename.split(path.sep).join('/');
const isDeclaration = filename => ['.d.cts', '.d.mts', '.d.ts'].some(suffix => filename.endsWith(suffix));

const listFiles = async (directory, relativeDirectory = '') => {
    const entries = await fs.readdir(path.join(directory, relativeDirectory), {withFileTypes: true});
    const files = [];
    for (const entry of entries) {
        const relativePath = path.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listFiles(directory, relativePath));
        } else if (entry.isFile()) {
            files.push(toPosix(relativePath));
        }
    }
    return files.sort();
};

const sourceToOutput = sourcePath => {
    const extension = path.extname(sourcePath);
    return `${sourcePath.slice(0, -extension.length)}${sourceExtensionMap.get(extension)}`;
};

const serverSourceMap = async () => {
    const sources = new Map();
    const rootEntries = await fs.readdir(applicationRoot, {withFileTypes: true});
    for (const entry of rootEntries) {
        if (!entry.isFile() || isDeclaration(entry.name) || !sourceExtensionMap.has(path.extname(entry.name))) {
            continue;
        }
        sources.set(toPosix(sourceToOutput(entry.name)), toPosix(entry.name));
    }
    for (const directory of serverDirectories) {
        for (const relativePath of await listFiles(path.join(applicationRoot, directory))) {
            if (isDeclaration(relativePath) || !sourceExtensionMap.has(path.extname(relativePath))) {
                continue;
            }
            const sourcePath = toPosix(path.join(directory, relativePath));
            sources.set(toPosix(sourceToOutput(sourcePath)), sourcePath);
        }
    }
    return sources;
};

const artifactServerFiles = async () => {
    const files = [];
    const rootEntries = await fs.readdir(artifactRoot, {withFileTypes: true});
    for (const entry of rootEntries) {
        if (entry.isFile() && ['.cjs', '.mjs', '.js'].includes(path.extname(entry.name))) {
            files.push(toPosix(entry.name));
        }
    }
    for (const directory of serverDirectories) {
        for (const relativePath of await listFiles(path.join(artifactRoot, directory))) {
            if (['.cjs', '.mjs', '.js'].includes(path.extname(relativePath))) {
                files.push(toPosix(path.join(directory, relativePath)));
            }
        }
    }
    return files.sort();
};

test('artifact rebuilds remove stale output', async () => {
    const staleFile = path.join(artifactRoot, 'stale-output.txt');
    await fs.writeFile(staleFile, 'stale');

    await execFileAsync(process.execPath, [buildScript], {
        cwd: applicationRoot,
        windowsHide: true,
    });

    await assert.rejects(fs.access(staleFile));
});

test('compiled artifact exposes the runnable application layout', async () => {
    const requiredPaths = [
        'index.mjs',
        'jobs',
        'modules',
        path.join('public', 'common.js'),
        'data',
        'translations',
        path.join('script', 'wait-for-db.mjs'),
        path.join('script', 'wait-for-it.sh'),
        'build-manifest.json',
    ];
    for (const relativePath of requiredPaths) {
        await fs.access(path.join(artifactRoot, relativePath));
    }

    const packageManifest = JSON.parse(await fs.readFile(path.join(artifactRoot, 'package.json')));
    assert.equal(packageManifest.main, 'index.mjs');
    assert.equal(packageManifest.engines.node, '24.x');
    assert.match(packageManifest.scripts.start, /--enable-source-maps/);
    assert.equal(packageManifest.type, undefined);

    const buildManifest = JSON.parse(await fs.readFile(path.join(artifactRoot, 'build-manifest.json')));
    assert.deepEqual(buildManifest, {
        schemaVersion: 'tarkov-data-manager/build-artifact/v1',
        entrypoint: 'index.mjs',
        workingDirectory: '.',
        jobDirectory: 'jobs',
        sourceMaps: true,
    });
});

test('emitted server files exactly mirror server sources', async () => {
    const expectedFiles = [...(await serverSourceMap()).keys()].sort();
    assert.deepEqual(await artifactServerFiles(), expectedFiles);
});

test('emitted jobs preserve dynamic-loader parity', async () => {
    const sourceJobs = (await listFiles(path.join(applicationRoot, 'jobs')))
        .filter(filename => ['.mjs', '.mts'].includes(path.extname(filename)))
        .map(sourceToOutput)
        .sort();
    const artifactJobs = (await listFiles(path.join(artifactRoot, 'jobs')))
        .filter(filename => path.extname(filename) === '.mjs')
        .sort();
    assert.deepEqual(artifactJobs, sourceJobs);

    const loader = await fs.readFile(path.join(artifactRoot, 'jobs', 'index.mjs'), 'utf8');
    assert.match(loader, /readdirSync\(import\.meta\.dirname\)/);
    assert.match(loader, /endsWith\(['"]\.mjs['"]\)/);
    assert.ok(loader.includes('await import(`./${file}`)'));
});

test('runtime assets are exact copies', async () => {
    for (const directory of assetDirectories) {
        const sourceFiles = await listFiles(path.join(applicationRoot, directory));
        const artifactFiles = await listFiles(path.join(artifactRoot, directory));
        assert.deepEqual(artifactFiles, sourceFiles, `${directory} file list differs`);
        for (const relativePath of sourceFiles) {
            const source = await fs.readFile(path.join(applicationRoot, directory, relativePath));
            const artifact = await fs.readFile(path.join(artifactRoot, directory, relativePath));
            assert.deepEqual(artifact, source, `${directory}/${relativePath} differs`);
        }
    }
    for (const relativePath of singletonAssets) {
        const source = await fs.readFile(path.join(applicationRoot, relativePath));
        const artifact = await fs.readFile(path.join(artifactRoot, relativePath));
        assert.deepEqual(artifact, source, `${relativePath} differs`);
    }
});

test('mutable runtime directories start empty', async () => {
    for (const directory of mutableDirectories) {
        assert.deepEqual(await fs.readdir(path.join(artifactRoot, directory)), []);
    }
});

test('artifact excludes credentials, governance, dependencies, and raw TypeScript', async () => {
    const forbiddenPaths = [
        '.codex',
        '.codex-local',
        '.env',
        'creds.env',
        'credsbpk.env',
        'node_modules',
    ];
    for (const relativePath of forbiddenPaths) {
        await assert.rejects(fs.access(path.join(artifactRoot, relativePath)));
    }
    const rawTypeScript = (await listFiles(artifactRoot))
        .filter(filename => ['.cts', '.mts', '.ts'].includes(path.extname(filename)));
    assert.deepEqual(rawTypeScript, []);
});

test('every emitted server file has a valid source map', async () => {
    const sources = await serverSourceMap();
    for (const [outputPath, sourcePath] of sources) {
        const absoluteOutput = path.join(artifactRoot, outputPath);
        const mapPath = `${absoluteOutput}.map`;
        const output = await fs.readFile(absoluteOutput, 'utf8');
        assert.match(output, new RegExp(`sourceMappingURL=${path.basename(outputPath)}\\.map`));

        const sourceMap = JSON.parse(await fs.readFile(mapPath, 'utf8'));
        assert.equal(sourceMap.version, 3);
        assert.equal(sourceMap.file, path.basename(outputPath));
        assert.ok(Array.isArray(sourceMap.sources) && sourceMap.sources.length > 0);
        assert.ok(sourceMap.sources.every(filename => !path.isAbsolute(filename)));

        const resolvedSources = sourceMap.sources.map(filename => path.resolve(
            path.dirname(mapPath),
            sourceMap.sourceRoot ?? '',
            filename,
        ));
        assert.ok(
            resolvedSources.includes(path.resolve(applicationRoot, sourcePath)),
            `${outputPath} does not map back to ${sourcePath}`,
        );
    }
});

test('all emitted and browser JavaScript parses under the active Node runtime', async () => {
    const browserJavaScript = (await listFiles(path.join(artifactRoot, 'public')))
        .filter(filename => ['.cjs', '.mjs', '.js'].includes(path.extname(filename)))
        .map(filename => toPosix(path.join('public', filename)));
    const files = [...await artifactServerFiles(), ...browserJavaScript].sort();
    const environment = {...process.env};
    delete environment.NODE_OPTIONS;

    for (const relativePath of files) {
        try {
            await execFileAsync(process.execPath, ['--check', path.join(artifactRoot, relativePath)], {
                cwd: artifactRoot,
                env: environment,
                windowsHide: true,
            });
        } catch (error) {
            assert.fail(`${relativePath} failed syntax validation: ${error.stderr || error.message}`);
        }
    }
});
