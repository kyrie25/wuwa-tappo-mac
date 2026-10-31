import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'acorn';
import { patchMacUpdater } from '../scripts/patch-frontend.mjs';
import { findSource } from './frontend-context.mjs';
import MarkdownIt from 'markdown-it';

const bridge = await readFile(new URL('../scripts/mac-updater.js', import.meta.url), 'utf8');

function runtime(handler, {shutdownError} = {}) {
  const fields = new Map();
  const calls = [];
  const dialog = { open: false, setAttribute() {}, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; },
    querySelector(selector) {
      const key = selector.match(/"(\w+)"/)[1];
      if (!fields.has(key)) fields.set(key, { hidden: false, textContent: '', disabled: false });
      return fields.get(key);
    },
  };
  const events = [];
  const window = { markdownit: MarkdownIt, __WUWATAPPO_UPDATE_SHUTDOWN__: async () => { calls.push({command:'shutdown'}); if(shutdownError)throw new Error(shutdownError); }, __TAURI__: {event:{listen:async (_name, listener) => {events.push(listener);return () => calls.push({command:'unlisten'});}}}, __TAURI_INTERNALS__: { invoke(command, args) {
    calls.push({ command, args });
    if (command === 'get_mac_build_info') return Promise.resolve({ forkVersion: '1.0.3-mac.3', resourceVersion: '1.0.3' });
    return Promise.resolve().then(() => handler(command, args));
  } } };
  vm.runInNewContext(bridge, { window, document: { createElement: () => dialog, body: { append() {} } } });
  return { check: window.__WUWATAPPO_UPDATER__.check, fields, calls, dialog, events };
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

test('available updates show both fork revisions, escaped HTML notes and explicit replacement instructions', async () => {
  const view = runtime(() => available);
  const result = await view.check({ interactive: true });
  assert.equal(result.kind, 'external');
  assert.equal(view.dialog.open, true);
  assert.match(view.fields.get('installed').textContent, /1.0.3-mac.3/);
  assert.match(view.fields.get('status').textContent, /1.0.3-mac.4/);
  assert.equal(view.fields.get('notes').innerHTML, '<p>&lt;script&gt;text only&lt;/script&gt;</p>\n');
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

test('release Markdown renders headings, lists, emphasis, code and safe links', async () => {
  const notes = '## Changelog\n\n- **Fixed** sleep with `Date.now()`\n\n[Details](https://github.com/kyrie25/wuwa-tappo-mac)\n\n[unsafe](javascript:alert(1))\n\n<img src=x onerror=alert(1)>';
  const view = runtime(() => ({ ...available, release: { ...available.release, notes } }));
  await view.check({ interactive: true });
  const html = view.fields.get('notes').innerHTML;
  assert.match(html, /<h2>Changelog<\/h2>/);
  assert.match(html, /<ul>\n<li><strong>Fixed<\/strong> sleep with <code>Date.now\(\)<\/code><\/li>/);
  assert.match(html, /<a href="https:\/\/github.com\/kyrie25\/wuwa-tappo-mac">Details<\/a>/);
  assert.doesNotMatch(html, /href="javascript:|<img|<script/);
  let prevented = false;
  await view.fields.get('notes').onclick({
    target: { closest: () => ({ href: 'https://github.com/kyrie25/wuwa-tappo-mac' }) },
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(view.calls.at(-1).command, 'plugin:opener|open_url');
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
  const directory = new URL('../.github/release-notes/', import.meta.url);
  const latest = (await readdir(directory)).filter(name => /^v\d+\.\d+\.\d+-mac\.\d+\.md$/.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1);
  assert.ok(latest, 'A versioned release-notes file is required');
  const notes = await readFile(new URL(latest, directory), 'utf8');
  const minimum = notes.match(/<!-- wuwa-mac-minimum: ([\d.]+) -->/)?.[1];
  assert.equal(minimum, base.bundle.macOS.minimumSystemVersion);
  assert.equal(minimum, global.bundle.macOS.minimumSystemVersion ?? base.bundle.macOS.minimumSystemVersion);
});


test('signed updates download and verify before saving state and installing', async () => {
  const view = runtime(() => ({ ...available, release:{...available.release, canInstall:true} }));
  await view.check({interactive:true});
  assert.equal(view.fields.get('install').hidden,false);
  view.calls.length=0;
  await view.fields.get('install').onclick();
  assert.deepEqual(view.calls.map(c=>c.command), ['download_mac_update','shutdown','install_mac_update','unlisten']);
  assert.equal(view.calls[0].args.version, '1.0.3-mac.4');
});

test('failed verification cannot shut down or install and exposes retry/manual download', async () => {
  const view = runtime(command => {
    if(command==='download_mac_update')throw new Error('Signature verification failed');
    return {...available,release:{...available.release,canInstall:true}};
  });
  await view.check({interactive:true});
  await view.fields.get('install').onclick();
  assert.equal(view.fields.get('title').textContent,'Could Not Install Update');
  assert.equal(view.fields.get('retry').hidden,false);
  assert.equal(view.fields.get('download').disabled,false);
  assert(!view.calls.some(c=>c.command==='shutdown'||c.command==='install_mac_update'));
});

test('session flush failure prevents installation and leaves the app open', async () => {
  const view=runtime(()=>({...available,release:{...available.release,canInstall:true}}),{shutdownError:'Session could not be saved'});
  await view.check({interactive:true});await view.fields.get('install').onclick();
  assert.match(view.fields.get('status').textContent,/Session could not be saved/);
  assert(!view.calls.some(c=>c.command==='install_mac_update'));
  assert.equal(view.dialog.open,true);
});

test('the actual regional patch preserves the original counter/socket shutdown hooks', () => {
  const {source}=findSource(content=>content.includes('async function checkForAppUpdate('));
  const patched=patchMacUpdater(source);
  assert.match(patched,/await requestPersistClicksBeforeExit\(\);await requestDisconnectSocketBeforeExit\(\);await window\.__WUWATAPPO_SESSION__\.flush\(\)/);
});


test('a failed native install leaves retry and manual download available', async () => {
  const view=runtime(command=>{
    if(command==='install_mac_update')throw new Error('Could not replace the app');
    return {...available,release:{...available.release,canInstall:true}};
  });
  await view.check({interactive:true});await view.fields.get('install').onclick();
  assert.equal(view.fields.get('title').textContent,'Could Not Install Update');
  assert.equal(view.fields.get('retry').hidden,false);
  assert.equal(view.fields.get('download').disabled,false);
  assert.equal(view.dialog.open,true);
});

test('repeated install clicks and checks cannot start a second download', async () => {
  let finish;
  const wait=new Promise(resolve=>finish=resolve);
  const view=runtime(command=>command==='download_mac_update'?wait:({...available,release:{...available.release,canInstall:true}}));
  await view.check({interactive:true});
  const install=view.fields.get('install').onclick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(view.fields.get('close').disabled,true);
  await view.fields.get('install').onclick();await view.check({interactive:true});
  view.events[0]({payload:{version:'1.0.3-mac.4',downloaded:20,total:100}});
  assert.match(view.fields.get('status').textContent,/20%/);
  assert.equal(view.calls.filter(c=>c.command==='download_mac_update').length,1);
  finish(null);await install;
});
