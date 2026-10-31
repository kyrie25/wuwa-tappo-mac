import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const versionPattern = '(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)';
const tagPattern = new RegExp(`^v${versionPattern}-mac\\.(0|[1-9][0-9]*)$`);

export function releaseTag(base, tags, requested = '') {
  if (!new RegExp(`^${versionPattern}$`).test(base)) throw new Error('Invalid application version.');
  const prefix = `v${base}-mac.`;
  const tag = requested || prefix + (tags.filter(tag => tagPattern.test(tag) && tag.startsWith(prefix))
    .reduce((max, tag) => BigInt(tag.slice(prefix.length)) > max ? BigInt(tag.slice(prefix.length)) : max, 0n) + 1n);
  if (!tagPattern.test(tag) || !tag.startsWith(prefix) || BigInt(tag.slice(prefix.length)) > 18446744073709551615n) {
    throw new Error(`Release tag must match ${prefix}REVISION and use an unsigned 64-bit revision.`);
  }
  return tag;
}

export function releaseNotes({ changelog = '', prepared = '', minimum }) {
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(minimum)) throw new Error('Invalid minimum macOS version.');
  if (prepared) {
    const headings = prepared.match(/^#+ .+$/gm) || [];
    if (!prepared.includes(`<!-- wuwa-mac-minimum: ${minimum} -->`) || headings.join('\n') !== '## Changelog\n## Instructions') {
      throw new Error('Prepared release notes need minimum-macOS metadata, Changelog and Instructions.');
    }
    return prepared;
  }
  if (!changelog.trim()) throw new Error('Enter a changelog in Run workflow, or commit the versioned release-notes file first.');
  if (/^\s*#/m.test(changelog)) throw new Error('Enter changelog bullet points without section headings.');
  const bullets = changelog.trim().split(/\r?\n/).filter(line => line.trim()).map(line => `- ${line.trim().replace(/^[-*]\s+/, '')}`).join('\n');
  return `<!-- wuwa-mac-minimum: ${minimum} -->\n\n## Changelog\n\n${bullets}\n\n## Instructions\n\n- Download the DMG or ZIP matching your account region: Global or CN.\n- To update an installed app, choose Settings → Check for Updates → Update and Restart.\n`;
}

export function prepareRelease({ projectRoot = process.cwd(), environment = process.env, execute = execFileSync } = {}) {
  const git = args => execute('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const tags = git(['tag', '--list']).split('\n');
  const requested = environment.RELEASE_TAG || '';
  if (requested && !tagPattern.test(requested)) throw new Error('Invalid requested release tag.');
  const source = requested && tags.includes(requested) ? requested : environment.GITHUB_SHA;
  const sha = git(['rev-parse', '--verify', '--end-of-options', `${source}^{commit}`]);
  const json = filename => JSON.parse(git(['show', `${sha}:${filename}`]));
  const config = json('src-tauri/tauri.conf.json');
  const global = json('src-tauri/tauri.global.conf.json');
  const base = config.version;
  const cargo = git(['show', `${sha}:src-tauri/Cargo.toml`]).match(/^version = "([^"]+)"$/m)?.[1];
  if ([global.version || base, cargo, json('upstream-cn.json').version, json('upstream-global.json').version].some(version => version !== base)) {
    throw new Error('Both regional resources, Tauri and Cargo must use the same reviewed official version before releasing.');
  }
  const minimum = config.bundle.macOS.minimumSystemVersion;
  if ((global.bundle?.macOS?.minimumSystemVersion || minimum) !== minimum) throw new Error('Regional minimum macOS versions differ.');
  const tag = releaseTag(base, tags, requested);
  const notesFile = `.github/release-notes/${tag}.md`;
  let prepared = '';
  try { prepared = git(['show', `${sha}:${notesFile}`]); } catch { /* New tags may use the manual changelog input. */ }
  const notes = releaseNotes({ changelog: environment.RELEASE_CHANGELOG, prepared, minimum });
  mkdirSync(path.join(projectRoot, '.work/release'), { recursive: true });
  writeFileSync(path.join(projectRoot, '.work/release/notes.md'), notes);
  if (!tags.includes(tag)) {
    git(['tag', tag, sha]);
    git(['push', 'origin', `refs/tags/${tag}`]);
  }
  appendFileSync(environment.GITHUB_OUTPUT, `tag=${tag}\nsha=${sha}\n`);
  appendFileSync(environment.GITHUB_STEP_SUMMARY, `## Release ${tag}\n\nSource: \`${sha}\`\n\n${notes}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { prepareRelease(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
