import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkOfficialVersions } from '../scripts/check-official.mjs';

async function check({ responses = {}, pending = [] } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'wuwa-version-check-'));
  const reports = [];
  const output = path.join(directory, 'output');
  const execute = (command, args, options) => {
    const region = options.env.WUWA_REGION;
    assert.equal(options.cwd, directory);
    if (command === 'gh') return JSON.stringify(pending);
    if (args[0] === 'scripts/upstream-review.mjs') { reports.push(region); return ''; }
    assert.deepEqual(args, ['scripts/sync-upstream.mjs', '--check']);
    const result = responses[region] ?? { changed: false, latestVersion: '1.0.4' };
    if (result instanceof Error) throw result;
    return JSON.stringify(result);
  };
  try {
    let error;
    try { await checkOfficialVersions({ projectRoot: directory, environment: { GITHUB_OUTPUT: output }, execute }); }
    catch (value) { error = value; }
    const values = Object.fromEntries((await readFile(output, 'utf8')).trim().split('\n').map(line => {
      const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
    }));
    return { error, reports, changed: values.changed, matrix: JSON.parse(values.matrix) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('unchanged official versions schedule no macOS jobs', async () => {
  const result = await check();
  assert.equal(result.error, undefined);
  assert.equal(result.changed, 'false');
  assert.deepEqual(result.matrix, { include: [] });
});

test('only changed regions without an exact pending candidate start native validation', async () => {
  const responses = { cn: { changed: true, latestVersion: '1.0.5' }, global: { changed: true, latestVersion: '1.0.5' } };
  const result = await check({ responses, pending: [{ title: 'Sync official CN resources 1.0.5' }, { title: 'Sync official Global resources 1.0.5 old' }] });
  assert.equal(result.error, undefined);
  assert.equal(result.changed, 'true');
  assert.deepEqual(result.matrix, { include: [{ region: 'global', label: 'Global' }] });
});

test('failed or malformed checks report their region and preserve the other eligible update', async () => {
  for (const response of [new Error('Official host unavailable'), { changed: 'true', latestVersion: '1.0.5' }, { changed: true, latestVersion: 'invalid' }]) {
    const result = await check({ responses: { cn: response, global: { changed: true, latestVersion: '1.0.5' } } });
    assert.ok(result.error);
    assert.deepEqual(result.reports, ['cn']);
    assert.equal(result.changed, 'true');
    assert.deepEqual(result.matrix, { include: [{ region: 'global', label: 'Global' }] });
  }
});
