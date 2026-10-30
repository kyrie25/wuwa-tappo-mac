import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';
import { patchMacUpdater } from '../scripts/patch-frontend.mjs';
import { findSource } from './frontend-context.mjs';

const bridge = await readFile(new URL('../scripts/mac-updater.js', import.meta.url), 'utf8');

function runtime(handler) {
  const fields = new Map();
  const calls = [];
  const dialog = { open: false, setAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; },
    querySelector(selector) {
      const key = selector.match(/"(\w+)"/)[1];
      if (!fields.has(key)) fields.set(key, { hidden: false, textContent: '', disabled: false });
      return fields.get(key);
    },
  };
  const window = { __TAURI_INTERNALS__: { invoke(command, args) {
    calls.push({ command, args });
    if (command === 'get_mac_build_info') return Promise.resolve({ forkVersion: '1.0.3-mac.3', resourceVersion: '1.0.3' });
    return Promise.resolve().then(() => handler(command, args));
  } } };
  vm.runInNewContext(bridge, { window, document: { createElement: () => dialog, body: { append() {} } } });
  return { check: window.__WUWATAPPO_UPDATER__.check, fields, calls, dialog };
}
const available = { status: 'available', currentVersion: '1.0.3-mac.3', resourceVersion: '1.0.3', release: {
  version: '1.0.3-mac.4', assetName: 'WuwaTappo-CN-Mac-1.0.3-arm64.dmg', notes: '<script>text only</script>',
} };

test('the actual regional frontend routes checks through the Mac bridge and cannot use the Windows installer', async () => {
  const { source } = findSource(content => content.includes('async function checkForAppUpdate('));
  const patched = patchMacUpdater(source);
  const names = ['checkForAppUpdate', 'downloadAndInstallAppUpdate', 'fetchUpdaterManifest', 'resolveUpdaterLatestJsonUrl'];
  const declarations = parse(patched, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .filter(n => n.type === 'FunctionDeclaration' && names.includes(n.id.name)).map(n => patched.slice(n.start, n.end));
  const calls = [];
  const api = vm.runInNewContext(declarations.join('\n') + ';({checkForAppUpdate,downloadAndInstallAppUpdate,fetchUpdaterManifest,resolveUpdaterLatestJsonUrl})', {
    window: { __WUWATAPPO_UPDATER__: { check: options => { calls.push(options); return 'Mac result'; } } },
  });
  assert.equal(await api.checkForAppUpdate({ interactive: true }), 'Mac result');
  assert.equal(calls[0].interactive, true);
  assert.equal(await api.fetchUpdaterManifest(), null);
  assert.match(await api.resolveUpdaterLatestJsonUrl(), /api.github.com\/repos\/kyrie25\/wuwa-tappo-mac\/releases/);
  await assert.rejects(api.downloadAndInstallAppUpdate(), /download the Mac package/);
  assert.throws(() => patchMacUpdater(''), /updater flow changed/);
});

test('available updates show both fork revisions, plain-text notes and explicit replacement instructions', async () => {
  const view = runtime(() => available);
  const result = await view.check({ interactive: true });
  assert.equal(result.kind, 'external');
  assert.equal(view.dialog.open, true);
  assert.match(view.fields.get('installed').textContent, /1.0.3-mac.3/);
  assert.match(view.fields.get('status').textContent, /1.0.3-mac.4/);
  assert.equal(view.fields.get('notes').textContent, '<script>text only</script>');
  assert.equal(view.fields.get('instructions').hidden, false);
  assert.equal(view.fields.get('download').textContent, 'Download DMG');
  await view.fields.get('download').onclick();
  assert.equal(view.calls.at(-1).command, 'open_mac_update');
  assert.equal(view.calls.at(-1).args.action, 'download');
  assert.deepEqual(Object.keys(view.calls.at(-1).args), ['action', 'version']);
  assert.equal(view.calls.at(-1).args.version, '1.0.3-mac.4');
  assert.match(view.fields.get('status').textContent, /Quit this app/);
  view.fields.get('close').onclick();
  assert.equal(view.dialog.open, false);
});

test('equal versions, absent releases and development builds have distinct results', async () => {
  for (const [status, title] of [['upToDate', 'You’re Up to Date'], ['noRelease', 'No Published Mac Release'], ['development', 'Latest Published Release']]) {
    const view = runtime(() => ({ ...available, status, currentVersion: status === 'development' ? null : available.currentVersion }));
    const result = await view.check({ interactive: true });
    assert.equal(view.fields.get('title').textContent, title);
    assert.equal(result.kind, status === 'upToDate' ? 'none' : 'external');
    assert.equal(view.fields.get('download').hidden, status !== 'development');
    if (status === 'development') assert.match(view.fields.get('installed').textContent, /Development build/);
  }
});

test('failed checks and failed browser opens remain visible and can be retried', async () => {
  let failed = true;
  const view = runtime(command => {
    if (failed || command === 'open_mac_update') throw new Error('GitHub unavailable');
    return available;
  });
  assert.equal((await view.check({ interactive: true })).kind, 'error');
  assert.match(view.fields.get('status').textContent, /GitHub unavailable/);
  assert.equal(view.fields.get('retry').hidden, false);
  failed = false;
  await view.fields.get('retry').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.fields.get('title').textContent, 'Update Available');
  await view.fields.get('download').onclick();
  assert.match(view.fields.get('status').textContent, /GitHub unavailable/);
  assert.equal(view.fields.get('download').disabled, false);
});

test('repeated interactive and silent checks share one pending native request', async () => {
  let resolve;
  const wait = new Promise(done => { resolve = done; });
  const view = runtime(() => wait);
  const first = view.check();
  const second = view.check({ interactive: true });
  assert.equal(view.fields.get('title').textContent, 'Checking for Updates');
  await new Promise(done => setImmediate(done));
  assert.equal(view.calls.filter(c => c.command === 'check_app_update').length, 1);
  resolve(available);
  assert.equal((await first).kind, 'external');
  assert.equal((await second).kind, 'external');
});

test('release metadata minimum matches both regional configurations', async () => {
  const base = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
  const global = JSON.parse(await readFile(new URL('../src-tauri/tauri.global.conf.json', import.meta.url)));
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const minimum = workflow.match(/<!-- wuwa-mac-minimum: ([\d.]+) -->/)?.[1];
  assert.equal(minimum, base.bundle.macOS.minimumSystemVersion);
  assert.equal(minimum, global.bundle.macOS.minimumSystemVersion ?? base.bundle.macOS.minimumSystemVersion);
});
