import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';
import { findSource, profile, root } from './frontend-context.mjs';
import { patchMacChestClock } from '../scripts/patch-frontend.mjs';

const original = findSource(source => source.includes('function Vn(){if(!R.isLoggedIn)'));
const prepared = await readFile(path.join(root, profile.preparedDir, 'assets', original.name), 'utf8');

function countdown(source = prepared) {
  const names = new Set(['fg', 'is', 'No', 'co', 'ic', 'Yr', 'Vn', 'Cp']);
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
    R: { isLoggedIn: true, userInfo: { left_treasure_chest: server + 120_000, right_treasure_chest: server + 180_000 } },
    Qn: { value: true }, Nt: { value: 0 }, Ht: { value: 0 }, Po: { value: 0 }, To: { value: 0 },
    fr: 30 * 60_000,
  });
  vm.runInContext(`let Ys=null,dd=0,kr=null,Cr=null;${functions.join('\n')}`, env);
  return {
    env, server,
    advance(milliseconds, sleeping = false) { wall += milliseconds; if (!sleeping) awake += milliseconds; },
    tick() { env.Vn(); return [env.Nt.value, env.Ht.value]; },
  };
}

test('original chest clock reproduces the lost sleep interval', () => {
  const clock = countdown(original.source);
  assert.equal(clock.env.fg(clock.server), true);
  clock.advance(10_000);
  clock.advance(50_000, true);
  assert.deepEqual(clock.tick(), [110_000, 170_000]);
});

test('server chest deadlines advance a full minute with only ten seconds awake', () => {
  const clock = countdown();
  assert.equal(clock.env.fg(clock.server), true);
  assert.deepEqual(clock.tick(), [120_000, 180_000]);
  clock.advance(10_000);
  clock.advance(50_000, true);
  assert.deepEqual(clock.tick(), [60_000, 120_000]);
  assert.equal(clock.env.is(), clock.server + 60_000);
  clock.advance(20_000);
  clock.advance(40_000, true);
  assert.deepEqual(clock.tick(), [0, 60_000]);
});

test('newly started left and right chests include sleep and expire at zero', () => {
  const clock = countdown();
  clock.env.fg(clock.server);
  clock.env.Cp('left');
  clock.advance(60_000, true);
  assert.deepEqual(clock.tick(), [1_740_000, 120_000]);
  clock.env.Cp('right');
  clock.advance(10_000);
  clock.advance(50_000, true);
  assert.deepEqual(clock.tick(), [1_680_000, 1_740_000]);
  clock.advance(60 * 60_000, true);
  assert.deepEqual(clock.tick(), [0, 0]);
  assert.equal(clock.env.ic(clock.env.Nt.value), 0);
  assert.equal(clock.env.ic(clock.env.Ht.value), 0);
});

test('server resynchronization preserves local chest deadlines and login gates', () => {
  const clock = countdown();
  assert.equal(clock.env.fg(NaN), false);
  assert.equal(clock.env.fg(0), false);
  clock.env.fg(clock.server);
  clock.env.Cp('left');
  clock.advance(60_000, true);
  clock.env.fg(clock.server + 65_000);
  assert.deepEqual(clock.tick(), [1_740_000, 115_000]);
  clock.env.Qn.value = false;
  clock.advance(60_000, true);
  assert.deepEqual(clock.tick(), [1_740_000, 115_000]);
  clock.env.Qn.value = true;
  assert.deepEqual(clock.tick(), [1_680_000, 55_000]);
  clock.env.R.isLoggedIn = false;
  assert.deepEqual(clock.tick(), [0, 0]);
  assert.equal(clock.env.Po.value, 0);
  assert.equal(clock.env.To.value, 0);
});

test('unknown or duplicate upstream chest clocks stop preparation', () => {
  assert.throws(() => patchMacChestClock(''), /Original chest clock changed/);
  assert.throws(() => patchMacChestClock(original.source.replace('Ys=n,dd=', 'Ys=n,other=')), /Original chest clock changed/);
  assert.throws(() => patchMacChestClock(original.source + original.source), /Original chest clock changed/);
});
