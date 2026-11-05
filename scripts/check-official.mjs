import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRegionProfile } from './regions.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

export async function checkOfficialVersions({ projectRoot = root, environment = process.env, execute = execFileSync } = {}) {
  const include = [], failures = [];
  for (const region of ['cn', 'global']) {
    const profile = getRegionProfile(region);
    const options = { cwd: projectRoot, env: { ...environment, WUWA_REGION: region }, encoding: 'utf8' };
    try {
      const result = JSON.parse(execute(process.execPath, ['scripts/sync-upstream.mjs', '--check'], options));
      if (typeof result.changed !== 'boolean' || !/^\d+\.\d+\.\d+$/.test(result.latestVersion)) throw new Error('Invalid official version response');
      const title = `Sync official ${profile.label} resources ${result.latestVersion}`;
      const open = JSON.parse(execute('gh', ['pr', 'list', '--state', 'open', '--search', `${title} in:title`, '--limit', '100', '--json', 'title'], options));
      const directory = path.join(projectRoot, '.work/upstream-checks', region);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'upstream-check.json'), `${JSON.stringify(result)}\n`);
      if (result.changed && !open.some(pr => pr.title === title)) include.push({ region, label: profile.label });
    } catch (error) {
      failures.push(`${profile.label}: ${error.message}`);
      try { execute(process.execPath, ['scripts/upstream-review.mjs', 'report'], { ...options, stdio: 'inherit' }); }
      catch (reportError) { failures.push(`${profile.label} report: ${reportError.message}`); }
    }
  }
  if (environment.GITHUB_OUTPUT) await appendFile(environment.GITHUB_OUTPUT, `changed=${include.length > 0}\nmatrix=${JSON.stringify({ include })}\n`);
  if (failures.length) throw new Error(failures.join('\n'));
  return { include };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkOfficialVersions().catch(error => { console.error(error.message); process.exitCode = 1; });
}
