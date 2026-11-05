import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';
import { patchEnglishFrontend } from '../scripts/english-frontend.mjs';
import { profile, root, findSource } from './frontend-context.mjs';

function declaration(source, name) {
  const node = parse(source, { sourceType: 'module', ecmaVersion: 'latest' }).body
    .find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
  assert.ok(node, `Missing ${name}`);
  return source.slice(node.start, node.end);
}

test('prepared CN and Global locale starts in English regardless of saved or system language', async () => {
  const main = findSource(source => source.includes('const initialLocale=getInitialAppLocale()'));
  const prepared = await readFile(path.join(root, profile.preparedDir, 'assets', main.name), 'utf8');
  const result = vm.runInNewContext(declaration(prepared, 'getInitialAppLocale') + ';getInitialAppLocale()', {
    localStorage: { getItem: () => 'tw' }, navigator: { language: 'zh-CN', languages: ['zh-CN'] }, getCookie: () => 'zh',
  });
  assert.equal(result, 'en');
  const html = await readFile(path.join(root, profile.preparedDir, 'index.html'), 'utf8');
  assert.ok(html.includes('<html lang="en">'));
});

test('actual prepared update messages cover latest, disabled, failed and missing updates in English', async () => {
  const main = findSource(source => source.includes('function resolveUpdateMissingMessage('));
  const prepared = await readFile(path.join(root, profile.preparedDir, 'assets', main.name), 'utf8');
  const bindings = new Map(parse(prepared, { sourceType: 'module', ecmaVersion: 'latest' }).body
    .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations.map(item => [item.id.name, item.init])));
  const english = Object.fromEntries(bindings.get('en').properties.map(property => [property.key.name,
    property.value.type === 'Identifier' ? bindings.get(property.value.name)?.value : property.value.value]));
  const message = vm.runInNewContext(declaration(prepared, 'resolveUpdateMissingMessage') + ';resolveUpdateMissingMessage', {
    i18n: { global: { t(key, values = {}) {
      assert.equal(typeof english[key], 'string', `Missing bundled English message: ${key}`);
      return english[key].replace(/\{(\w+)\}/g, (_, name) => values[name]);
    } } },
  });
  assert.equal(message({ kind: 'none', currentVersion: '1.0.4' }), "You're already using the latest version (v1.0.4).");
  assert.equal(message({ kind: 'disabled' }), 'Update check not initiated.');
  assert.equal(message({ kind: 'error' }), 'Failed to check for updates.');
  assert.equal(message({ kind: 'error', message: 'Native Mac explanation' }), 'Native Mac explanation');
  assert.equal(message({ kind: 'available' }), 'No update is ready to install. Please check for updates first.');
});

test('all prepared modules parse and hardcoded update and login messages are translated', async () => {
  const directory = path.join(root, profile.preparedDir, 'assets');
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.js'))) {
    const source = await readFile(path.join(directory, name), 'utf8');
    parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
    for (const text of ['更新资源地址尚未就绪', '检查更新失败', '暂无更新说明', '关闭登录方式选择', '请输入游戏特征码/UID', '海外登录回调 state 无效或已过期']) {
      assert.ok(!source.includes(text), `${name}: ${text}`);
    }
  }
});

test('translation preserves template expressions, module imports and unrelated protocol values', () => {
  const source = 'import x from "./upstream.js"; const a=`当前已是最新版本（${version}）`, b="检查更新失败", protocol="cat-settings-locale";';
  const prepared = patchEnglishFrontend(source);
  parse(prepared, { sourceType: 'module', ecmaVersion: 'latest' });
  assert.ok(prepared.includes('`Already up to date (${version})`'));
  assert.ok(prepared.includes('"Could not check for updates."'));
  assert.ok(prepared.includes('"./upstream.js"'));
  assert.ok(prepared.includes('protocol="cat-settings-locale"'));
});

test('the English About fallback identifies the Mac build and original Windows requirements', async () => {
  const about = findSource(source => /t=[$\w]+\(\(\)=>k\("about_content"\)/.test(source));
  const prepared = await readFile(path.join(root, profile.preparedDir, 'assets', about.name), 'utf8');
  assert.ok(!/<h2 data-v-[a-f0-9]+>Device Requirements<\/h2>/.test(prepared));
  const paragraphs = [...prepared.matchAll(/<h2 data-v-[a-f0-9]+>Wuwa Tappo<\/h2>/g)];
  assert.ok(paragraphs.length >= 3, 'Mac information must appear in bundled English content and the remote banner');
});
