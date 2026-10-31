import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';
import { findSource, profile, root } from './frontend-context.mjs';
import { patchMacPanelAssetHost } from '../scripts/patch-frontend.mjs';

const layout = findSource(source => source.includes('[main] window layout during open failed'));
const prepared = await readFile(path.join(root, profile.preparedDir, 'assets', layout.name), 'utf8');
const main = findSource(source => source.includes('const APP_REGION='));
const panel = findSource(source => source.includes('__name:"MainModulePanel"'));

function nodes(source, predicate) {
  const matches = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) matches.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
  return matches;
}

function panelHost(source, host) {
  const [snapshot] = nodes(source, node => node.type === 'ObjectExpression' && ['streamId', 'assetsJsonTs', 'atlasList'].every(key => node.properties.some(property => property.key?.name === key)));
  const property = snapshot.properties.find(property => property.key.name === 'assetsCdnHost');
  const original = nodes(layout.source, node => node.type === 'ObjectExpression' && node.properties.some(property => property.key?.name === 'assetsCdnHost'))[0].properties.find(property => property.key.name === 'assetsCdnHost').value;
  return vm.runInNewContext(source.slice(property.value.start, property.value.end), { [original.object.name]: { value: host } });
}

function imageResolver() {
  const names = new Set(['resolveBagAppearanceImageUrl', 'toCatalogAssetType', 'resolveAppearanceAtlasUrl', 'getAppearanceAtlasById', 'atlasTypeToAssetType', 'withAssetUrlCacheBust', 'buildAssetUrl', 'isLocalRoleAssetsHost', 'resolveLocalRoleAssetUrl', 'bagAppearanceAssetPath', 'appearanceAssetPath', 'resolveAppearanceAssetFolder']);
  const functions = nodes(main.source, node => node.type === 'FunctionDeclaration' && names.has(node.id.name));
  assert.equal(functions.length, names.size);
  const env = vm.createContext({
    LOCAL_ROLE_ASSETS_HOST: '__local_role_assets__', ASSET_URL_CACHE_BUST: 'test', loadedAssetsHost: profile.assetsOrigin,
    localRoleAssetUrlByPath: {}, APPEARANCE_ASSET_TYPE_FOLDER: { emote_atlas: 'emote_atlas' }, appearanceAtlasCatalog: { value: new Map([[42, { asset_type: 'emote_atlas', url: 'emote_atlas/catalog-image.png?v=1' }]]) },
  });
  vm.runInContext(functions.map(node => main.source.slice(node.start, node.end)).join('\n'), env);
  return host => env.resolveBagAppearanceImageUrl(host, { asset_id: 42, asset_type: 'emote_atlas', asset_name: 'legacy-emote.png' });
}

test('signed-out local pet host reproduces missing Gallery images even with a loaded catalog', () => {
  const host = panelHost(layout.source, '__local_role_assets__');
  assert.equal(host, '__local_role_assets__');
  assert.equal(imageResolver()(host), '');
});

test('signed-out Gallery uses the regional public catalog without changing the pet source', () => {
  const host = panelHost(prepared, '__local_role_assets__');
  assert.equal(host, profile.assetsOrigin);
  assert.equal(imageResolver()(host), `${profile.assetsOrigin}/emote_atlas/catalog-image.png?v=1&t=test`);
  assert.equal(panelHost(prepared, ''), profile.assetsOrigin);
  assert.equal(panelHost(prepared, undefined), profile.assetsOrigin);
  assert.equal(panelHost(prepared, profile.assetsOrigin), profile.assetsOrigin);
  assert.equal(panelHost(prepared, 'https://assets.example'), 'https://assets.example');
});

test('public Gallery host reaches the existing catalog loader while the original local marker skips it', async () => {
  const [loader] = nodes(panel.source, node => node.type === 'FunctionDeclaration' && node.async && panel.source.slice(node.start, node.end).includes('assetsJsonTs'));
  assert.ok(loader);
  const body = panel.source.slice(loader.start, loader.end);
  const [call] = nodes(body, node => node.type === 'AwaitExpression');
  const [comparison] = nodes(body, node => node.type === 'BinaryExpression' && node.operator === '===' && node.right.type === 'Identifier');
  const requests = [];
  const env = vm.createContext({ [comparison.right.name]: '__local_role_assets__', [call.argument.callee.name]: async options => requests.push(options) });
  vm.runInContext(body, env);
  await env[loader.id.name]({ assetsCdnHost: panelHost(layout.source, '__local_role_assets__'), assetsJsonTs: 123 });
  assert.equal(requests.length, 0);
  await env[loader.id.name]({ assetsCdnHost: panelHost(prepared, '__local_role_assets__'), assetsJsonTs: 123 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].assetsHost, profile.assetsOrigin);
  assert.equal(requests[0].assetsJsonTs, 123);
});

test('asset host patch stops preparation if the original snapshot changes', () => {
  assert.throws(() => patchMacPanelAssetHost('const snapshot={assetsCdnHost:""}', profile.assetsOrigin), /snapshot changed/);
  assert.throws(() => patchMacPanelAssetHost(layout.source + ';const extra={streamId:0,assetsJsonTs:0,atlasList:[],assetsCdnHost:""}', profile.assetsOrigin));
});
