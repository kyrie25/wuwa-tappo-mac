import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';
import { findSource, profile, root } from './frontend-context.mjs';
import { patchMacChestClock } from '../scripts/patch-frontend.mjs';

const original = findSource(source => source.includes('function Un(){if(!A.isLoggedIn)'));
const prepared = await readFile(path.join(root, profile.preparedDir, 'assets', original.name), 'utf8');

function countdown(source = prepared) {
  const names = new Set(['gg', 'fs', 'Go', 'ho', 'cc', '$r', 'Un', 'Ih']);
  const functions = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && names.has(node.id.name)) functions.push(source.slice(node.start, node.end));
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(parse(source, { sourceType: 'module', ecmaVersion: 'latest' }));
  assert.equal(functions.length, names.size);
  let wall = 1_700_000_000_000, awake = 1000;
  const server = wall + 30_000;
  const env = vm.createContext({
    Date: { now: () => wall }, performance: { now: () => awake },
    A: { isLoggedIn: true, userInfo: { left_treasure_chest: server + 120_000, right_treasure_chest: server + 180_000 } },
    eo: { value: true }, Bt: { value: 0 }, Nt: { value: 0 }, Do: { value: 0 }, Lo: { value: 0 },
    gr: 30 * 60_000,
  });
  vm.runInContext(`let js=null,vd=0,Ir=null,Mr=null;${functions.join('\n')}`, env);
  return {
    env, server,
    advance(milliseconds, sleeping = false) { wall += milliseconds; if (!sleeping) awake += milliseconds; },
    tick() { env.Un(); return [env.Bt.value, env.Nt.value]; },
  };
}

test('original chest clock reproduces the lost sleep interval', () => {
  const clock = countdown(original.source);
  assert.equal(clock.env.gg(clock.server), true);
  clock.advance(10_000);
  clock.advance(50_000, true);
  assert.deepEqual(clock.tick(), [110_000, 170_000]);
});

test('server chest deadlines advance a full minute with only ten seconds awake', () => {
  const clock = countdown();
  assert.equal(clock.env.gg(clock.server), true);
  assert.deepEqual(clock.tick(), [120_000, 180_000]);
  clock.advance(10_000);
  clock.advance(50_000, true);
  assert.deepEqual(clock.tick(), [60_000, 120_000]);
  assert.equal(clock.env.fs(), clock.server + 60_000);
  clock.advance(20_000);
  clock.advance(40_000, true);
  assert.deepEqual(clock.tick(), [0, 60_000]);
});

test('newly started left and right chests include sleep and expire at zero', () => {
  const clock = countdown();
  clock.env.gg(clock.server);
  clock.env.Ih('left');
  clock.advance(60_000, true);
  assert.deepEqual(clock.tick(), [1_740_000, 120_000]);
  clock.env.Ih('right');
  clock.advance(10_000);
  clock.advance(50_000, true);
  assert.deepEqual(clock.tick(), [1_680_000, 1_740_000]);
  clock.advance(60 * 60_000, true);
  assert.deepEqual(clock.tick(), [0, 0]);
  assert.equal(clock.env.cc(clock.env.Bt.value), 0);
  assert.equal(clock.env.cc(clock.env.Nt.value), 0);
});

test('server resynchronization preserves local chest deadlines and login gates', () => {
  const clock = countdown();
  assert.equal(clock.env.gg(NaN), false);
  assert.equal(clock.env.gg(0), false);
  clock.env.gg(clock.server);
  clock.env.Ih('left');
  clock.advance(60_000, true);
  clock.env.gg(clock.server + 65_000);
  assert.deepEqual(clock.tick(), [1_740_000, 115_000]);
  clock.env.eo.value = false;
  clock.advance(60_000, true);
  assert.deepEqual(clock.tick(), [1_740_000, 115_000]);
  clock.env.eo.value = true;
  assert.deepEqual(clock.tick(), [1_680_000, 55_000]);
  clock.env.A.isLoggedIn = false;
  assert.deepEqual(clock.tick(), [0, 0]);
  assert.equal(clock.env.Do.value, 0);
  assert.equal(clock.env.Lo.value, 0);
});

test('unknown or duplicate upstream chest clocks stop preparation', () => {
  assert.throws(() => patchMacChestClock(''), /Original chest clock changed/);
  assert.throws(() => patchMacChestClock(original.source.replace('js=n,vd=', 'js=n,other=')), /Original chest clock changed/);
  assert.throws(() => patchMacChestClock(original.source + original.source));
});

test('rebuilt chest variable and function names preserve sleep-aware behavior', () => {
  const aliases = { gg: 'syncClock', fs: 'currentClock', Un: 'tickChests', Ih: 'startChest', js: 'serverStamp', vd: 'clockBaseline' };
  function rename(source, names) {
    const edits = new Map();
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'Identifier' && Object.hasOwn(names, node.name)) edits.set(node.start, { start: node.start, end: node.end, name: names[node.name] });
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
    }
    visit(parse(source, { sourceType: 'module', ecmaVersion: 'latest' }));
    for (const edit of [...edits.values()].sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.name + source.slice(edit.end);
    return source;
  }
  const patched = patchMacChestClock(rename(original.source, aliases));
  const clock = countdown(rename(patched, Object.fromEntries(Object.entries(aliases).map(([a, b]) => [b, a]))));
  clock.env.gg(clock.server);
  clock.env.Ih('left');
  clock.advance(60_000, true);
  assert.deepEqual(clock.tick(), [1_740_000, 120_000]);
});
