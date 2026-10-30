import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRegionProfile } from './regions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const reviewStages = ['inventory', 'frontend', 'native', 'build', 'package'];

function entryContract({ callSites, ...entry }) {
  return { ...entry, payloadReads: [...new Set(callSites.flatMap(site => site.payloadReads || []))].sort() };
}

export function inventoryChanges(accepted, observed) {
  const diff = key => {
    const before = new Map(accepted[key].map(entry => [entry.name, entryContract(entry)]));
    const after = new Map(observed[key].map(entry => [entry.name, entryContract(entry)]));
    return {
      added: [...after.keys()].filter(name => !before.has(name)),
      removed: [...before.keys()].filter(name => !after.has(name)),
      changed: [...after.keys()].filter(name => before.has(name) && !isDeepStrictEqual(before.get(name), after.get(name))),
    };
  };
  return {
    region: observed.sourceApplication.region,
    acceptedVersion: accepted.sourceApplication.version,
    observedVersion: observed.sourceApplication.version,
    acceptedEntry: accepted.sourceApplication.entryModule,
    observedEntry: observed.sourceApplication.entryModule,
    commands: diff('commands'), events: diff('events'),
    runtimeConstants: { changed: !isDeepStrictEqual(accepted.runtimeConstants, observed.runtimeConstants), accepted: accepted.runtimeConstants, observed: observed.runtimeConstants },
    // Full call-site anchors remain in observed-inventory.json; this summary is not an acceptance gate.
  };
}

export async function writeInventoryReview(projectRoot = root, profile = getRegionProfile()) {
  const { inventoryAssets } = await import('./inventory-contract.mjs');
  const lock = JSON.parse(await readFile(path.join(projectRoot, profile.upstreamLock), 'utf8'));
  const acceptedPath = path.join(projectRoot, 'tests', profile.id === 'cn' ? 'contracts.json' : 'contracts-global.json');
  const accepted = JSON.parse(await readFile(acceptedPath, 'utf8'));
  const observed = inventoryAssets(path.join(projectRoot, profile.frontendDir, 'assets'), { version: lock.version });
  const output = path.join(projectRoot, '.work/upstream-review');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'observed-inventory.json'), `${JSON.stringify(observed, null, 2)}\n`);
  await writeFile(path.join(output, 'contract-changes.json'), `${JSON.stringify(inventoryChanges(accepted, observed), null, 2)}\n`);
}

export function exactIssueNumber(issues, title) {
  return issues.find(issue => issue.title === title)?.number ?? null;
}

export function updatePullRequestArguments({ profile, version, branch, runUrl, outcomes }) {
  const validated = reviewStages.every(stage => outcomes[stage] === 'success');
  const results = reviewStages.map(stage => `- ${stage}: ${outcomes[stage] || 'skipped'}`).join('\n');
  const body = [
    `Pin official ${profile.label} resources to ${version}. The other region is unchanged.`,
    validated ? 'Resource checks, contract tests, Rust tests, native build and ZIP/DMG packaging passed. Verify real account login, input permissions and multiplayer before merging and releasing.' : 'This candidate has not passed compatibility validation. Keep this PR as a draft until interface changes are reviewed, failures are fixed and CI passes for both regions.',
    results,
    `Run, failure logs, observed inventory and contract differences: [Actions](${runUrl}). Review evidence: official-${profile.id}-review; packages after full validation: official-${profile.id}-candidate.`,
  ].join('\n\n');
  return ['pr', 'create', '--base', 'main', '--head', branch, '--title', `Sync official ${profile.label} resources ${version}`, '--body', body, ...(validated ? [] : ['--draft'])];
}

export async function openUpdatePullRequest({ projectRoot = root, profile = getRegionProfile(), environment = process.env, execute = execFileSync } = {}) {
  const check = JSON.parse(await readFile(path.join(projectRoot, '.work/upstream-check.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(check.latestVersion) || !/^\d+$/.test(environment.GITHUB_RUN_ID)) throw new Error('Invalid update version or run ID');
  const branch = `codex/official-${profile.id}-${check.latestVersion}-${environment.GITHUB_RUN_ID}`;
  if (!execute('git', ['diff', '--', profile.upstreamLock], { cwd: projectRoot, encoding: 'utf8' }).trim()) return;
  const run = (command, args) => execute(command, args, { cwd: projectRoot, stdio: 'inherit' });
  run('git', ['switch', '-c', branch]);
  run('git', ['config', 'user.name', 'github-actions[bot]']);
  run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  run('git', ['add', '--', profile.upstreamLock]);
  run('git', ['commit', '-m', `chore: sync official ${profile.id} resources ${check.latestVersion}`]);
  run('git', ['push', 'origin', branch]);
  const outcomes = Object.fromEntries(reviewStages.map(stage => [stage, environment[`${stage.toUpperCase()}_OUTCOME`]]));
  const runUrl = `https://github.com/${environment.GITHUB_REPOSITORY}/actions/runs/${environment.GITHUB_RUN_ID}`;
  run('gh', updatePullRequestArguments({ profile, version: check.latestVersion, branch, runUrl, outcomes }));
}

export function reportFailure({ profile = getRegionProfile(), environment = process.env, execute = execFileSync } = {}) {
  const title = `Official ${profile.label} synchronization needs attention`;
  const issues = JSON.parse(execute('gh', ['issue', 'list', '--state', 'open', '--search', `${title} in:title`, '--limit', '100', '--json', 'number,title'], { encoding: 'utf8' }));
  const number = exactIssueNumber(issues, title);
  const runUrl = `https://github.com/${environment.GITHUB_REPOSITORY}/actions/runs/${environment.GITHUB_RUN_ID}`;
  const body = `Official ${profile.label} synchronization or compatibility validation failed. No new version was released. Failed steps, logs and available review evidence: ${runUrl}`;
  execute('gh', number === null ? ['issue', 'create', '--title', title, '--body', body] : ['issue', 'comment', String(number), '--body', body], { stdio: 'inherit' });
}

async function main(action) {
  if (action === 'inventory') return writeInventoryReview();
  if (action === 'open-pr') return openUpdatePullRequest();
  if (action === 'report') return reportFailure();
  throw new Error(`Unknown upstream review action: ${action}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
