import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';
import { contract, findSource, profile, root } from './frontend-context.mjs';

const actions = ['gameMode', 'switchScreen', 'togglePet', 'alwaysOnTop', 'autoGameModeOnFullscreen', 'disablePointerMonitoring'];

test('official shortcut contracts include configuration, capture, change notification and all six actions', () => {
  const command = name => contract.commands.find(item => item.name === name);
  const event = name => contract.events.find(item => item.name === name);
  assert.deepEqual(Object.keys(command('get_app_shortcuts').response.properties), actions);
  assert.equal(command('set_app_shortcuts').request.properties.config.type, 'object');
  assert.equal(command('set_shortcut_capture').request.properties.active.type, 'boolean');
  assert.deepEqual(event('app-shortcut').payload.enum, actions);
  assert.deepEqual(event('app-shortcuts-changed').payload, command('get_app_shortcuts').response);
  assert.ok(contract.bootContract.inputRegistration.includes('app-shortcut'));
  assert.deepEqual(contract.runtimeConstants.defaultAppShortcuts, {
    gameMode: { modifiers: 0, key: 118 }, switchScreen: { modifiers: 0, key: 119 }, togglePet: { modifiers: 0, key: 120 },
    alwaysOnTop: { modifiers: 0, key: 0 }, autoGameModeOnFullscreen: { modifiers: 0, key: 0 }, disablePointerMonitoring: { modifiers: 0, key: 0 },
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
  const { callSites: [site] } = contract.events.find(event => event.name === 'app-shortcut');
  const callback = parse(site.source, { ecmaVersion: 'latest' }).body[0].expression.arguments[1];
  const handlerName = callback.body.callee.name;
  let node;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'FunctionDeclaration' && value.id.name === handlerName) node = value;
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  visit(parse(view.source, { sourceType: 'module', ecmaVersion: 'latest' }));
  assert.ok(node);
  const source = view.source.slice(node.start, node.end);
  const guard = node.body.body[0];
  const blockedName = guard.test.argument.callee.name;
  const [auto, pointer, other] = guard.consequent.body;
  const [top] = auto.test.expressions;
  for (const blocked of [false, true]) for (const action of [...actions, 'unknown']) {
    const calls = [], environment = { [blockedName]: () => blocked };
    environment[top.right.callee.name] = () => calls.push(top.left.right.value);
    for (const branch of other.expression.expressions) {
      const name = branch.left.left.right.value;
      environment[branch.left.right.callee.name] = () => true;
      environment[branch.right.callee.name] = () => calls.push(name);
    }
    for (const branch of [auto, pointer]) {
      const [setting, effects] = branch.consequent.body;
      const currentValue = setting.declarations[0].init.argument;
      const name = currentValue.property.name;
      environment[currentValue.object.callee.name] = () => ({ [action]: false });
      const [save, update, notify] = effects.expression.expressions;
      environment[save.callee.name] = patch => assert.deepEqual({ ...patch }, { [action]: true });
      if (update.type === 'AssignmentExpression') environment[update.left.object.name] = { value: false };
      environment[notify.callee.name] = enabled => {
        assert.equal(enabled, true);
        calls.push(name);
      };
    }
    const handler = vm.runInNewContext(source + ';' + node.id.name, environment);
    handler(action);
    assert.deepEqual(calls, !blocked && action !== 'unknown' ? [action] : []);
  }
});
