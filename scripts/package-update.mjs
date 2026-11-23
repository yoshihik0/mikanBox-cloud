import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_splitSqlQuery as splitSql } from 'wrangler';

const root = fileURLToPath(new URL('../', import.meta.url));
const configFile = 'wrangler.production.example.json';
const releaseDir = join(root, '.build-release');
const packageName = 'mikanbox-cloud-update-package.json';
const manifestName = 'mikanbox-cloud-update.json';
const require = createRequire(import.meta.url);
const { hash: blake3 } = createRequire(require.resolve('wrangler'))('blake3-wasm');

const assetTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webp': 'image/webp',
};

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

async function json(file) {
  return JSON.parse(await readFile(join(root, file), 'utf8'));
}

async function trackedFiles(directory) {
  const paths = git('ls-files', '-z', '--', directory).split('\0').filter(Boolean).sort();
  for (const path of paths) {
    if (!(await lstat(join(root, path))).isFile()) {
      throw new Error(`Release path must be a regular file: ${path}`);
    }
  }
  return paths;
}

async function readAssets(directory) {
  const assets = [];
  for (const file of await trackedFiles(directory)) {
    const path = file.slice(directory.length);
    const extension = extname(path);
    const type = assetTypes[extension];
    if (!type || !path.startsWith('/') || path.split('/').some(segment => segment.startsWith('.'))) {
      throw new Error(`Unsupported update asset: ${file}`);
    }
    const bytes = await readFile(join(root, file));
    const content = bytes.toString('base64');
    // Use the same content and extension hash as Wrangler Workers Assets.
    const hash = blake3(content + extension.slice(1)).toString('hex').slice(0, 32);
    assets.push({ path, content, type, hash, size: bytes.length });
  }
  if (!assets.length) throw new Error('The release has no static assets.');
  return assets;
}

async function readMigrations(directory) {
  const migrations = [];
  let lastNumber = 0;
  for (const file of await trackedFiles(directory)) {
    const name = basename(file);
    const number = Number(/^(\d{4})_[a-z0-9_]+\.sql$/.exec(name)?.[1]);
    if (!(number > lastNumber) || file !== `${directory}/${name}`) {
      throw new Error(`Invalid migration path or numbering: ${file}`);
    }
    const statements = splitSql(await readFile(join(root, file), 'utf8')).filter(Boolean);
    if (!statements.length) throw new Error(`Empty migration: ${name}`);
    migrations.push({ name, statements });
    lastNumber = number;
  }
  if (!migrations.length) throw new Error('The release has no D1 migrations.');
  return migrations;
}

async function buildMain(entryPoint) {
  const buildDir = await mkdtemp(join(tmpdir(), 'mikanbox-release-'));
  try {
    execFileSync(process.execPath, [
      'node_modules/wrangler/bin/wrangler.js', 'deploy',
      '--config', configFile, '--dry-run', '--outdir', buildDir,
    ], {
      cwd: root,
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: join(buildDir, 'wrangler.log'),
        WRANGLER_SEND_METRICS: 'false',
      },
      stdio: 'inherit',
    });
    const name = `${basename(entryPoint, extname(entryPoint))}.js`;
    for (const output of await readdir(buildDir)) {
      if (![name, `${name}.map`, 'README.md', 'wrangler.log'].includes(output)) {
        throw new Error(`The update package cannot deploy extra bundle output: ${output}`);
      }
    }
    const bundle = await readFile(join(buildDir, name), 'utf8');
    return { name, content: bundle.replace(/^\/\/# sourceMappingURL=.*\n?$/m, '') };
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.length === 1 && args[0] === '--dry-run';
  if (args.length && !dryRun) throw new Error('Usage: node scripts/package-update.mjs [--dry-run]');
  const commit = git('rev-parse', '--verify', 'HEAD^{commit}').trim();
  const status = () => git('status', '--porcelain', '--untracked-files=normal');
  if (!dryRun && status()) throw new Error('Commit release files before packaging an update.');

  const [{ version }, { minimum_version }, config, versionSource] = await Promise.all([
    json('package.json'),
    json('update-policy.json'),
    json(configFile),
    readFile(join(root, 'src/version.ts'), 'utf8'),
  ]);
  const runtimeVersion = /\bCLOUD_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(versionSource)?.[1];
  const versionPattern = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
  if (!versionPattern.test(version) || version !== runtimeVersion) {
    throw new Error('package.json and CLOUD_VERSION must use the same release version.');
  }
  if (typeof minimum_version !== 'string' || !versionPattern.test(minimum_version) ||
      version.localeCompare(minimum_version, 'en', { numeric: true }) < 0) {
    throw new Error('update-policy.json must specify a minimum_version at or below the release version.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date) ||
      config.compatibility_flags?.length ||
      config.assets?.binding !== 'ASSETS' || config.assets.run_worker_first !== true ||
      config.assets.html_handling || config.assets.not_found_handling || config.assets.base_path ||
      config.d1_databases?.length !== 1 || config.d1_databases[0].binding !== 'DB') {
    throw new Error('The production configuration does not match the update package format.');
  }
  const assetDirectory = config.assets.directory.replace(/^\.\//, '').replace(/\/$/, '');
  const [assets, migrations] = await Promise.all([
    readAssets(assetDirectory),
    readMigrations(config.d1_databases[0].migrations_dir),
  ]);
  const worker = await buildMain(config.main);
  const payload = JSON.stringify({ version, main: worker, assets, migrations });
  const packageSize = Buffer.byteLength(payload);
  if (packageSize > 12 * 1024 * 1024) {
    throw new Error('The package exceeds the Cloud updater’s 12 MiB download limit.');
  }
  const manifest = {
    edition: 'cloud',
    version,
    minimum_version,
    commit,
    sha256: createHash('sha256').update(payload).digest('hex'),
    compatibility_date: config.compatibility_date,
    migrations: migrations.map(({ name }) => name),
  };
  if (!dryRun) {
    if (status() || git('rev-parse', 'HEAD').trim() !== commit) {
      throw new Error('The checkout changed while building the update package.');
    }
    await mkdir(releaseDir, { recursive: true });
    await writeFile(join(releaseDir, packageName), payload);
    await writeFile(join(releaseDir, manifestName), JSON.stringify(manifest, null, 2) + '\n');
  }
  const summary = `v${version}: ${assets.length} assets, ${migrations.length} migrations, ${packageSize} bytes`;
  console.log(dryRun ? `Validated update package ${summary}` : `Wrote update package ${summary} to ${releaseDir}`);
}

await main();
