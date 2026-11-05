import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareRelease, releaseNotes, releaseTag } from '../scripts/prepare-release.mjs';
import { mergeCandidate, requestOfficialRelease } from '../scripts/release-official.mjs';
import { candidateFiles, prepareCompatibleMetadata } from '../scripts/upstream-review.mjs';
import { getRegionProfile } from '../scripts/regions.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('release versions select the next numeric revision and reject mismatched or malformed tags', () => {
  assert.equal(releaseTag('1.0.3', ['v1.0.3-mac.9', 'v1.0.3-mac.2', 'v1.0.2-mac.50']), 'v1.0.3-mac.10');
  assert.equal(releaseTag('1.0.4', ['v1.0.3-mac.9']), 'v1.0.4-mac.1');
  assert.equal(releaseTag('1.0.3', [], 'v1.0.3-mac.7'), 'v1.0.3-mac.7');
  for (const tag of ['v1.0.4-mac.1', 'v1.0.3-mac.01', 'v1.0.3-mac.18446744073709551616', '--help', 'v1.0.3-mac.1\nfoo']) assert.throws(() => releaseTag('1.0.3', [], tag));
});

test('manual notes require a changelog or a correctly structured prepared file', () => {
  assert.throws(() => releaseNotes({minimum:'13.0'}), /Enter a changelog/);
  assert.throws(() => releaseNotes({minimum:'13.0', changelog:'## Wrong heading'}), /without section headings/);
  const notes = releaseNotes({minimum:'13.0', changelog:'Fix counting.\n- Update artwork.'});
  assert.match(notes, /^<!-- wuwa-mac-minimum: 13.0 -->/);
  assert.match(notes, /- Fix counting.\n- Update artwork\./);
  assert.equal(releaseNotes({minimum:'13.0', prepared:notes}), notes);
  assert.throws(() => releaseNotes({minimum:'14.0', prepared:notes}), /minimum-macOS/);
  assert.throws(() => releaseNotes({minimum:'13.0', prepared:notes+'\n## Validation\nTests passed.'}), /Changelog and Instructions/);
});

test('manual preparation tags exactly the selected commit and can retry an existing tag without retagging it', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'wuwa-release-'));
  const git = args => execFileSync('git', args, {cwd:directory, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
  try {
    git(['init']);git(['config','user.name','Release test']);git(['config','user.email','release@example.invalid']);
    await mkdir(path.join(directory,'src-tauri'),{recursive:true});
    for(const file of ['upstream-cn.json','upstream-global.json']) await writeFile(path.join(directory,file),'{"version":"1.0.3"}');
    await writeFile(path.join(directory,'src-tauri/tauri.conf.json'),JSON.stringify({version:'1.0.3',bundle:{macOS:{minimumSystemVersion:'13.0'}}}));
    await writeFile(path.join(directory,'src-tauri/tauri.global.conf.json'),'{"version":"1.0.3"}');
    await writeFile(path.join(directory,'src-tauri/Cargo.toml'),'[package]\nversion = "1.0.3"\n');
    git(['add','.']);git(['commit','-m','fixture']);const sha=git(['rev-parse','HEAD']);git(['tag','v1.0.3-mac.9']);
    const environment={GITHUB_SHA:sha,RELEASE_CHANGELOG:'Update documentation.',GITHUB_OUTPUT:path.join(directory,'output'),GITHUB_STEP_SUMMARY:path.join(directory,'summary')};
    const pushes=[];const execute=(command,args,options)=>{if(command==='git'&&args[0]==='push'){pushes.push(args);return ''}return execFileSync(command,args,options)};
    prepareRelease({projectRoot:directory,environment,execute});
    assert.equal(git(['rev-parse','v1.0.3-mac.10']),sha);
    assert.deepEqual(pushes,[['push','origin','refs/tags/v1.0.3-mac.10']]);
    assert.match(await readFile(environment.GITHUB_OUTPUT,'utf8'),new RegExp(`tag=v1.0.3-mac.10\\nsha=${sha}`));
    prepareRelease({projectRoot:directory,environment:{...environment,RELEASE_TAG:'v1.0.3-mac.10'},execute});assert.equal(pushes.length,1);
    assert.throws(()=>prepareRelease({projectRoot:directory,environment:{...environment,RELEASE_TAG:'v1.0.3-mac.11',RELEASE_CHANGELOG:''},execute}),/Enter a changelog/);
    assert.equal(git(['tag','--list','v1.0.3-mac.11']),'');assert.equal(pushes.length,1);
    await writeFile(path.join(directory,'upstream-global.json'),'{"version":"1.0.4"}');git(['add','.']);git(['commit','-m','mismatch']);
    assert.throws(()=>prepareRelease({projectRoot:directory,environment:{...environment,GITHUB_SHA:git(['rev-parse','HEAD'])},execute}),/same reviewed official version/);
    assert.equal(pushes.length,1);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('compatible metadata advances only the selected region and rejects changed contracts without writing fixtures', async () => {
  for(const region of ['cn','global']) {
    const directory=await mkdtemp(path.join(tmpdir(),'wuwa-compatible-'));const profile=getRegionProfile(region);const files=candidateFiles(profile);
    try {
      for(const file of files) {await mkdir(path.dirname(path.join(directory,file)),{recursive:true});await copyFile(path.join(root,file),path.join(directory,file));}
      const read=async file=>JSON.parse(await readFile(path.join(directory,file),'utf8'));
      const lock=await read(profile.upstreamLock);const version=lock.version.split('.').map((value,index)=>Number(value)+(index===2?1:0)).join('.');lock.version=version;await writeFile(path.join(directory,profile.upstreamLock),JSON.stringify(lock));
      const observed=await read(files[1]);observed.sourceApplication.version=version;await mkdir(path.join(directory,'.work/upstream-review'),{recursive:true});
      const observedFile=path.join(directory,'.work/upstream-review/observed-inventory.json');await writeFile(observedFile,JSON.stringify(observed));
      await prepareCompatibleMetadata(directory,profile);
      assert.equal((await read(files[1])).sourceApplication.version,version);assert.equal((await read(files[3])).version,version);
      assert.equal((await read(files[2])).application,`WuwaTappo-${region} ${version}`);assert.equal((await read('package.json')).version,version);
      assert.ok((await readFile(path.join(directory,'src-tauri/Cargo.lock'),'utf8')).includes(`name = "wuwatappo-mac"\nversion = "${version}"`));
      const before=await Promise.all(files.map(file=>readFile(path.join(directory,file),'utf8')));
      observed.commands[0].callSites[0].source+='changed';await writeFile(observedFile,JSON.stringify(observed));
      await assert.rejects(prepareCompatibleMetadata(directory,profile),/inventory changed/);
      assert.deepEqual(await Promise.all(files.map(file=>readFile(path.join(directory,file),'utf8'))),before);
    } finally {await rm(directory,{recursive:true,force:true});}
  }
});

const candidate={region:'cn',version:'1.0.4',branch:'codex/official-cn-1.0.4-123',head:'a'.repeat(40),validated:true};
const pullRequest=()=>({number:12,state:'OPEN',isDraft:false,isCrossRepository:false,baseRefName:'main',headRefName:candidate.branch,headRefOid:candidate.head,files:[{path:'upstream-cn.json'}]});

test('automatic merging requires the exact tested head, same-repository PR and allowed regional files', () => {
  for(const mutation of [p=>p.headRefOid='b'.repeat(40),p=>p.isDraft=true,p=>p.isCrossRepository=true,p=>p.baseRefName='other',p=>p.files.push({path:'src-tauri/src/lib.rs'}),p=>p.files.push({path:'upstream-global.json'})]) {
    const pr=pullRequest();mutation(pr);const calls=[];
    assert.throws(()=>mergeCandidate(candidate,(command,args)=>{calls.push(args);return JSON.stringify(pr)}),/differs from the validated/);
    assert.equal(calls.length,1);
  }
  const calls=[];let merged=false;
  assert.equal(mergeCandidate(candidate,(command,args)=>{calls.push(args);if(args[1]==='merge'){merged=true;return ''}return JSON.stringify(merged?{state:'MERGED'}:pullRequest())}),true);
  assert.deepEqual(calls[1],['pr','merge','12','--merge','--match-head-commit',candidate.head]);
  assert.equal(mergeCandidate({...candidate,validated:false},()=>assert.fail('draft must not merge')),false);
  assert.equal(mergeCandidate({...candidate,validated:'false'},()=>assert.fail('invalid flag must not merge')),false);
  let callsForPending=0;
  assert.throws(()=>mergeCandidate(candidate,()=>JSON.stringify(++callsForPending===1?pullRequest():{state:'OPEN'})),/merge requirements/);
});

test('official releases wait for matching regions and dispatch once per new official version', () => {
  for(const [cn,global,tags,dispatch] of [['1.0.4','1.0.3','',false],['1.0.4','1.0.4','v1.0.4-mac.1',false],['1.0.4','1.0.4','',true]]) {
    const calls=[];requestOfficialRelease((command,args)=>{calls.push([command,args]);if(command==='gh')return '';if(args[0]==='show')return JSON.stringify({version:args[1].includes('upstream-cn')?cn:global});if(args[0]==='tag')return tags;return ''});
    assert.equal(calls.some(([command])=>command==='gh'),dispatch);
    if(dispatch)assert.deepEqual(calls.at(-1),['gh',['workflow','run','release.yml','--ref','main','--field','tag=v1.0.4-mac.1','--field','changelog=Update CN and Global official resources to 1.0.4.']]);
  }
});
