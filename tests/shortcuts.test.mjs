import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';
import { contract, findSource, profile, root } from './frontend-context.mjs';

test('official shortcut contracts include configuration, capture, change notification and all three actions', () => {
  const command = name => contract.commands.find(item => item.name === name);
  const event = name => contract.events.find(item => item.name === name);
  assert.deepEqual(Object.keys(command('get_app_shortcuts').response.properties), ['gameMode', 'switchScreen', 'togglePet']);
  assert.equal(command('set_app_shortcuts').request.properties.config.type, 'object');
  assert.equal(command('set_shortcut_capture').request.properties.active.type, 'boolean');
  assert.deepEqual(event('app-shortcut').payload.enum, ['gameMode', 'switchScreen', 'togglePet']);
  assert.deepEqual(event('app-shortcuts-changed').payload, command('get_app_shortcuts').response);
  assert.ok(contract.bootContract.inputRegistration.includes('app-shortcut'));
  assert.deepEqual(contract.runtimeConstants.defaultAppShortcuts, {
    gameMode: { modifiers: 0, key: 118 }, switchScreen: { modifiers: 0, key: 119 }, togglePet: { modifiers: 0, key: 120 },
  });
});

test('prepared shortcut labels use Command and Option without changing keyboard event key identities', async () => {
  const main = findSource(source => source.includes('const DEFAULT_APP_SHORTCUTS='));
  const source = await readFile(path.join(root, profile.preparedDir, 'assets', main.name), 'utf8');
  const functions = parse(source, { sourceType: 'module', ecmaVersion: 'latest' }).body
    .filter(node => node.type === 'FunctionDeclaration' && ['formatShortcut', 'formatModifiers'].includes(node.id.name));
  assert.equal(functions.length, 2);
  const format = vm.runInNewContext(functions.map(node => source.slice(node.start, node.end)).join(';') + ';formatShortcut', { keyLabels: {} });
  assert.equal(format({ modifiers: 8, key: 65 }), 'Cmd+A');
  assert.equal(format({ modifiers: 1, key: 118 }), 'Option+F7');
  assert.equal(format({ modifiers: 0, key: 0 }), '');
  const setting = findSource(value => value.includes('"set_app_shortcuts"'));
  assert.ok(setting.source.includes('["Control","Alt","Shift","Meta"]'), 'DOM modifier identities must stay unchanged');
});

test('upstream native shortcut consumer dispatches only its requested action and respects its input guard', () => {
  const view = findSource(source => source.includes('"app-shortcut"'));
  let node;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'FunctionDeclaration') {
      const text = view.source.slice(value.start, value.end);
      if (text.length < 300 && text.includes('==="togglePet"') && text.includes('==="gameMode"')) node = value;
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  visit(parse(view.source, { sourceType: 'module', ecmaVersion: 'latest' }));
  assert.ok(node);
  const source = view.source.slice(node.start, node.end);
  const blockedName = node.body.body[0].expression.left.callee.name;
  const branches = node.body.body[0].expression.right.expressions;
  for (const blocked of [false, true]) for (const action of ['togglePet', 'gameMode', 'switchScreen', 'unknown']) {
    const calls = [], environment = { [blockedName]: () => blocked };
    for (const branch of branches) {
      const name = branch.left.left.right.value;
      environment[branch.left.right.callee.name] = () => true;
      environment[branch.right.callee.name] = () => calls.push(name);
    }
    const handler = vm.runInNewContext(source + ';' + node.id.name, environment);
    handler(action);
    assert.deepEqual(calls, !blocked && action !== 'unknown' ? [action] : []);
  }
});
