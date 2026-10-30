import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { getRegionProfile } from './regions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cn = getRegionProfile('cn');
export const configUrl = cn.configUrl;
export const assetsOrigin = cn.assetsOrigin;

export function officialAssetUrl(value, profile = cn) {
  const url = new URL(value);
  if (url.origin !== profile.assetsOrigin || url.username || url.password || url.hash) {
    throw new Error(`Asset URLs must use the official ${profile.label} HTTPS origin.`);
  }
  return url.href;
}

export function parseManifest(manifest, manifestUrl, profile = cn) {
  officialAssetUrl(manifestUrl, profile);
  const version = manifest?.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Invalid official version number.');
  }
  const url = officialAssetUrl(manifest?.platforms?.['windows-x86_64']?.url, profile);
  if (new URL(url).pathname.split('/').at(-1) !== `WuwaTappo-${profile.id}_${version}_x64-setup.exe`) {
    throw new Error(`The official manifest must provide a ${profile.label} installer matching its version.`);
  }
  const signature = manifest.platforms['windows-x86_64'].signature;
  if (typeof signature !== 'string' || !signature.trim()) throw new Error('The official manifest has no installer signature.');
  return { schemaVersion: 1, region: profile.region, version, manifestUrl, installer: { url, signature } };
}

export function validateLock(lock, profile = cn) {
  if (lock?.schemaVersion !== 1 || lock.region !== profile.region) throw new Error(`The resource lock must use schemaVersion 1 for ${profile.region}.`);
  parseManifest({ version: lock.version, platforms: { 'windows-x86_64': lock.installer } }, lock.manifestUrl, profile);
  if (!/^[a-f0-9]{64}$/.test(lock.installer.sha256) || !Number.isSafeInteger(lock.installer.size) || lock.installer.size <= 0) {
    throw new Error('The resource lock has no valid SHA-256 or file size.');
  }
  return lock;
}

export function verifyInstaller(bytes, lock, profile = cn) {
  validateLock(lock, profile);
  if (bytes.length !== lock.installer.size) throw new Error(`${profile.region} installer size mismatch. Download the pinned version again.`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== lock.installer.sha256) throw new Error(`${profile.region} installer SHA-256 mismatch. Build stopped.`);
  return { sha256, size: bytes.length };
}

export function compareUpstream(current, latest) {
  if (current.region !== latest.region) throw new Error('Cannot compare resource locks from different regions.');
  return {
    region: latest.region,
    regionId: latest.region.toLowerCase(),
    changed: current.version !== latest.version || current.installer.url !== latest.installer.url || current.installer.signature !== latest.installer.signature,
    currentVersion: current.version,
    latestVersion: latest.version,
    installerUrl: latest.installer.url,
  };
}

const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
const retryableCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);

function errorDetails(error) {
  const details = [];
  for (let cause = error; cause instanceof Error && !details.includes(cause); cause = cause.cause) details.push(cause);
  return details;
}

export async function fetchOfficial(url, { fetcher = fetch, read = response => response.json(), stage, timeout = 30_000, sleep = delay } = {}) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(timeout) });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        await response.body?.cancel();
        throw error;
      }
      return await read(response);
    } catch (error) {
      const causes = errorDetails(error);
      const transient = retryableStatuses.has(error.status) || causes.some(cause => retryableCodes.has(cause.code) || cause.name === 'TimeoutError');
      if (transient && attempt < 3) {
        await sleep(250 * 2 ** (attempt - 1));
        continue;
      }
      const reason = causes.map(cause => `${cause.message}${cause.code ? ` (${cause.code})` : ''}`).join(' → ') || String(error);
      throw new Error(`${stage || 'Official resource request'} failed: ${url}; attempt ${attempt}: ${reason}`, { cause: error });
    }
  }
}

export async function discoverUpstream(fetcher = fetch, profile = cn) {
  const config = await fetchOfficial(profile.configUrl, { fetcher, stage: `${profile.region} activity configuration` });
  if (config.code !== 0 || typeof config.data?.assets_host !== 'string') throw new Error(`Invalid ${profile.region} activity configuration.`);
  const host = officialAssetUrl(config.data.assets_host, profile);
  if (new URL(host).pathname !== '/') throw new Error(`Invalid ${profile.region} asset root URL.`);
  const pointer = await fetchOfficial(new URL(`/app/json-host/${profile.updaterHostFile}`, host).href, { fetcher, stage: `${profile.region} version pointer` });
  const manifestUrl = officialAssetUrl(pointer.url, profile);
  return parseManifest(await fetchOfficial(manifestUrl, { fetcher, stage: `${profile.region} version manifest` }), manifestUrl, profile);
}

async function exists(filename) {
  try { await access(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function findSevenZip(explicit, environment = process.env) {
  for (const candidate of [explicit, environment.SEVENZIP, '7zz', '7z'].filter(Boolean)) {
    const probe = spawnSync(candidate, ['i'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (!probe.error && probe.status === 0) return candidate;
    if (candidate === explicit || candidate === environment.SEVENZIP) throw new Error(`Could not run the specified 7-Zip: ${candidate}`);
  }
  throw new Error('7-Zip not found. Install sevenzip or specify --sevenzip /path/to/7zz.');
}

function installerCachePath(url, work, profile) {
  const parts = new URL(officialAssetUrl(url, profile)).pathname.split('/').filter(Boolean).map(encodeURIComponent);
  return path.join(work, 'installers', ...parts);
}

export function pinnedInstallerCache(lock, projectRoot = root, profile = cn) {
  validateLock(lock, profile);
  return {
    key: `official-installer-v1-${profile.id}-${lock.installer.size}-${lock.installer.sha256}-${encodeURIComponent(new URL(lock.installer.url).pathname)}`,
    path: installerCachePath(lock.installer.url, path.join(projectRoot, '.work'), profile),
  };
}

export async function downloadInstaller(lock, { profile = cn, updateLock = false, fetcher = fetch, sleep = delay } = {}) {
  if (updateLock) parseManifest({ version: lock.version, platforms: { 'windows-x86_64': lock.installer } }, lock.manifestUrl, profile);
  else validateLock(lock, profile);
  const bytes = await fetchOfficial(lock.installer.url, {
    stage: `${profile.region} installer download`, timeout: 300_000, fetcher, sleep,
    read: async response => Buffer.from(await response.arrayBuffer()),
  });
  if (lock.installer.sha256) verifyInstaller(bytes, lock, profile);
  return bytes;
}

async function installerBytes(lock, options, work, profile) {
  if (options.installer) return { filename: path.resolve(options.installer), bytes: await readFile(options.installer) };
  const filename = installerCachePath(lock.installer.url, work, profile);
  if (!options.updateLock && await exists(filename)) return { filename, bytes: await readFile(filename) };
  const bytes = await downloadInstaller(lock, { profile, updateLock: options.updateLock });
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(`${filename}.download`, bytes);
  await rename(`${filename}.download`, filename);
  return { filename, bytes };
}

export async function syncUpstream(options = {}, projectRoot = root) {
  const profile = getRegionProfile();
  const lockPath = path.join(projectRoot, profile.upstreamLock);
  const current = validateLock(JSON.parse(await readFile(lockPath, 'utf8')), profile);
  const latest = options.check || options.updateLock ? await discoverUpstream(fetch, profile) : current;
  const comparison = compareUpstream(current, latest);
  if (options.check) return comparison;
  const target = options.updateLock ? latest : current;
  const sevenzip = findSevenZip(options.sevenzip);
  const work = path.join(projectRoot, '.work');
  await mkdir(work, { recursive: true });
  const { filename, bytes } = await installerBytes(target, options, work, profile);
  if (options.updateLock) {
    target.installer = { ...target.installer, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
    // A same-version download must not silently replace a previously pinned artifact.
    if (!comparison.changed) verifyInstaller(bytes, current, profile);
  }
  verifyInstaller(bytes, target, profile);
  const staging = await mkdtemp(path.join(work, `upstream-${profile.id}-`));
  const output = path.join(staging, 'frontend');
  const frontend = path.join(projectRoot, profile.frontendDir);
  const backup = path.join(staging, 'previous-frontend');
  try {
    const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/extract-assets.mjs'),
      '--installer', filename, '--sevenzip', sevenzip, '--output', output], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${profile.region} resource extraction failed: ${result.stderr.trim() || result.stdout.trim()}`);
    const extracted = JSON.parse(result.stdout);
    const hadFrontend = await exists(frontend);
    if (hadFrontend) await rename(frontend, backup);
    try { await rename(output, frontend); }
    catch (error) { if (hadFrontend) await rename(backup, frontend); throw error; }
    if (options.updateLock) await writeFile(lockPath, `${JSON.stringify(target, null, 2)}\n`);
    await writeFile(path.join(work, profile.id === 'cn' ? 'upstream-extraction.json' : `upstream-${profile.id}-extraction.json`), result.stdout);
    return { ...comparison, version: target.version, region: target.region, files: extracted.count, staticReferences: extracted.staticReferences };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--check') options.check = true;
    else if (arg === '--update-lock') options.updateLock = true;
    else if (arg === '--installer' || arg === '--sevenzip') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path.`);
      options[arg.slice(2)] = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.check && (options.updateLock || options.installer || options.sevenzip)) throw new Error('--check only checks versions and cannot be combined with download or extraction options.');
  if (options.updateLock && options.installer) throw new Error('--update-lock must download from the official source; a local installer cannot be used.');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => syncUpstream(parseOptions(process.argv.slice(2))))
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
