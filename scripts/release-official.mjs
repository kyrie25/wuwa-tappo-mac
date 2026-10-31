import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidateFiles } from './upstream-review.mjs';
import { getRegionProfile } from './regions.mjs';

export function mergeCandidate(candidate, execute = execFileSync) {
  if (candidate.validated !== true) return false;
  const profile = getRegionProfile(candidate.region);
  const prefix = `codex/official-${profile.id}-${candidate.version}-`;
  if (!/^\d+\.\d+\.\d+$/.test(candidate.version) || !candidate.branch.startsWith(prefix) ||
      !/^\d+$/.test(candidate.branch.slice(prefix.length)) || !/^[a-f0-9]{40}$/.test(candidate.head)) throw new Error('Invalid validated candidate identity.');
  const gh = args => execute('gh', args, { encoding: 'utf8' });
  const pr = JSON.parse(gh(['pr', 'view', candidate.branch, '--json', 'number,state,isDraft,isCrossRepository,baseRefName,headRefName,headRefOid,files']));
  if (pr.headRefOid !== candidate.head || pr.headRefName !== candidate.branch || pr.baseRefName !== 'main' || pr.isCrossRepository || pr.isDraft ||
      !pr.files.some(file => file.path === profile.upstreamLock) || pr.files.some(file => !candidateFiles(profile).includes(file.path))) throw new Error('Candidate PR differs from the validated regional update.');
  if (pr.state === 'MERGED') return true;
  if (pr.state !== 'OPEN') throw new Error('Validated candidate PR is no longer open.');
  gh(['pr', 'merge', String(pr.number), '--merge', '--match-head-commit', candidate.head]);
  const merged = JSON.parse(gh(['pr', 'view', String(pr.number), '--json', 'state']));
  if (merged.state !== 'MERGED') throw new Error('Candidate is awaiting repository merge requirements.');
  return true;
}

export function requestOfficialRelease(execute = execFileSync) {
  const git = args => execute('git', args, { encoding: 'utf8' }).trim();
  git(['fetch', 'origin', 'main', '--tags']);
  const json = filename => JSON.parse(git(['show', `origin/main:${filename}`]));
  const cn = json('upstream-cn.json').version;
  const global = json('upstream-global.json').version;
  if (cn !== global) return 'Waiting for CN and Global to use the same official version.';
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(cn)) throw new Error('Invalid merged official version.');
  if (git(['tag', '--list', `v${cn}-mac.*`])) return 'This official version already has a release tag; no automatic revision requested.';
  execute('gh', ['workflow', 'run', 'release.yml', '--ref', 'main', '--field', `tag=v${cn}-mac.1`, '--field', `changelog=Update CN and Global official resources to ${cn}.`], { stdio: 'inherit' });
  return `Requested Release for official ${cn}. Both regional release builds must pass before publication.`;
}

async function main() {
  const directory = '.work/sync-candidates';
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  let merged = false;
  for (const entry of entries.filter(entry => entry.isDirectory())) {
    const candidate = JSON.parse(await readFile(path.join(directory, entry.name, 'candidate.json'), 'utf8'));
    merged = mergeCandidate(candidate) || merged;
  }
  console.log(merged ? requestOfficialRelease() : 'No validated official updates to merge or release.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
