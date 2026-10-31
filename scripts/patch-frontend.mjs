export function patchSessionBarriers(source, expected = 2) {
  let changes = 0;
  const patched = source.replace(
    /async function (invoke(?:\$\d+)?)\(e,t=\{\},n\)\{return window\.__TAURI_INTERNALS__\.invoke\(e,t,n\)\}/g,
    (_, name) => {
      changes += 1;
      return `async function ${name}(e,t={},n){if(e==="open_login_window"||e==="open_panel_window"||e==="plugin:event|emit"&&(t.event==="cat-auth-login-success"||t.event==="cat-auth-logout"))await window.__WUWATAPPO_SESSION__?.flush();return window.__TAURI_INTERNALS__.invoke(e,t,n)}`;
    },
  );
  if (changes !== expected) throw new Error(`Expected ${expected} original Tauri invoke wrappers, found ${changes}. Reconcile the app version before building.`);
  return patched;
}

export function patchLoginReady(source) {
  const original='function N(n){return o(u,t=>{n(t.payload??{})})}';
  const replacement='async function N(n){const unlisten=await o(u,t=>{n(t.payload??{})});await window.__TAURI_INTERNALS__.invoke("login_window_ready");return unlisten}';
  if(source.split(original).length!==2) throw new Error('Original login listener bridge changed; reconcile modal readiness before building.');
  return source.replace(original,replacement);
}

export function patchDomesticSdkUrls(source) {
  if (!source.includes('const APP_REGION="CN"')) {
    throw new Error('Expected the official CN frontend. Extract the CN installer before building.');
  }
  let changes = 0;
  const patched = source.replace(
    /(isdk(?:Src|Css)=")(\/\/pro-cdn-sdk\.kurogame\.com\/pro\/web-sdk\/1\.x\/(?:kr-sdk\.js|style\.css)")/g,
    (_, prefix, url) => {
      changes += 1;
      return `${prefix}https:${url}`;
    },
  );
  if (changes !== 2) throw new Error(`Expected 2 CN SDK URLs, found ${changes}. Reconcile the app version before building.`);
  return patched;
}

export function patchDomesticLoginReload(source) {
  const start = 'async function we(e=!1){if(E)return E;if(!e&&$())';
  const end = 'async function me()';
  const insertion = ',document.head.appendChild(t),r=window.setTimeout(';
  const offset = source.indexOf(start);
  const limit = source.indexOf(end, offset);
  if (offset < 0 || limit < 0 || source.split(start).length !== 2) {
    throw new Error('Original CN SDK reload function changed; reconcile the login reload patch before building.');
  }
  const loader = source.slice(offset, limit);
  if (!loader.includes('t.dataset.kuroSdkRetry="true"') || loader.split(insertion).length !== 2) {
    throw new Error('Original CN SDK script insertion changed; reconcile the login reload patch before building.');
  }
  const replacement = ',e&&([...document.scripts].filter(s=>s.src===t.src).forEach(s=>s.remove()),document.getElementById("KrSDK")?.remove())' + insertion;
  return source.slice(0, offset) + loader.replace(insertion, replacement) + source.slice(limit);
}

export function patchMacUpdateFeedback(source) {
  const pattern = /if\(([$\w]+)\.kind==="error"\)\{([^{}]*?)([$\w]+)\.value=([$\w]+)\("setting_version_check_failed"\);return\}/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('Original update feedback changed; reconcile the Mac update message before building.');
  return source.replace(pattern, (_, error, before, target, translate) => `if(${error}.kind==="external"){${target}.value=${error}.message;return}if(${error}.kind==="error"){${before}${target}.value=${error}.message||${translate}("setting_version_check_failed");return}`);
}

export function patchMacUpdater(source) {
  const replacements = {
    checkForAppUpdate: 'async function checkForAppUpdate(options){return window.__WUWATAPPO_UPDATER__.check(options)}',
    resolveUpdaterLatestJsonUrl: 'async function resolveUpdaterLatestJsonUrl(){return "https://api.github.com/repos/kyrie25/wuwa-tappo-mac/releases?per_page=100"}',
    fetchUpdaterManifest: 'async function fetchUpdaterManifest(){return null}',
    downloadAndInstallAppUpdate: 'async function downloadAndInstallAppUpdate(){throw new Error("Use Check for Updates to install the signed Mac update or download the Mac package.")}',
  };
  const tree = parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
  const targets = tree.body.filter(node => node.type === 'FunctionDeclaration' && Object.hasOwn(replacements, node.id.name));
  if (targets.length !== Object.keys(replacements).length) throw new Error('Original updater flow changed; reconcile the Mac update path before building.');
  for (const node of targets.sort((a, b) => b.start - a.start)) source = source.slice(0, node.start) + replacements[node.id.name] + source.slice(node.end);
  for (const name of ['requestPersistClicksBeforeExit', 'requestDisconnectSocketBeforeExit']) {
    if (!tree.body.some(node => node.type === 'FunctionDeclaration' && node.id.name === name)) throw new Error('Original shutdown flow changed; reconcile update persistence before building.');
  }
  return source + '\nObject.defineProperty(window,"__WUWATAPPO_UPDATE_SHUTDOWN__",{value:async()=>{await requestPersistClicksBeforeExit();await requestDisconnectSocketBeforeExit();await window.__WUWATAPPO_SESSION__.flush()}});';
}

export function patchMacAbout(source, region = 'CN') {
  const headings = [...source.matchAll(/<h2 (data-v-[a-f0-9]+)>系统配置<\/h2>/g)];
  if (headings.length !== 1) throw new Error('Original About system section changed; reconcile the Mac build information before building.');
  const original = headings[0][0], scope = headings[0][1];
  const remotes = [...source.matchAll(/t=([$\w]+)\(\(\)=>k\("about_content"\)\?String\(v\("about_content"\)\)\.trim\(\):""\)/g)];
  if (remotes.length !== 1) throw new Error('Original remote About content changed; reconcile the Mac build information before building.');
  const [remote, computed] = remotes[0];
  const info = region === 'GLOBAL'
    ? `<h2 ${scope}>Wuwa Tappo</h2><p ${scope}>Wuwa Tappo · Global service · Apple Silicon · macOS 13+</p>`
    : `<h2 ${scope}>Wuwa Tappo</h2><p ${scope}>Wuwa Tappo · CN service · Apple Silicon · macOS 13+</p>`;
  const banner = `<section class="about-section" ${scope}>${info}</section>`;
  return source
    .replace(original, `${info}<h3 ${scope}>Original Windows requirements</h3>`)
    .replace(/<h2 (data-v-[a-f0-9]+)>(?:System Requirements|Device Requirements)<\/h2>/g, `${info}<h3 ${scope}>Original Windows requirements</h3>`)
    .replace(remote, `t=${computed}(()=>{const html=k("about_content")?String(v("about_content")).trim():"";return html&&!/\\p{Script=Han}/u.test(html)?${JSON.stringify(banner)}+html.replace("系统配置","Original Windows requirements").replace("系統配備","Original Windows requirements").replace("System Requirements","Original Windows requirements").replace("Device Requirements","Original Windows requirements"):""})`);
}

export function patchGlobalAuthListener(source) {
  const bridge = 'async function onOpenUrl(e){return await listen("deep-link://new-url",t=>{e(t.payload)})}';
  const wake = 'async function onOpenUrl(e){return await listen("mac-oauth-callback-ready",()=>{getCurrent().then(t=>{if(t?.length)return e(t)}).catch(()=>console.warn("[macOS] OAuth callback could not be read"))})}';
  const current = 'try{const t=await getCurrent();t?.length&&handleRawUrls(t)}catch(t){console.warn("[overseas-auth] getCurrent failed:",t)}';
  const listener = 'try{unlisten=await onOpenUrl(t=>{handleRawUrls(t)})}catch(t){throw console.warn("[overseas-auth] onOpenUrl failed:",t),bound=!1,t}';
  if (source.split(bridge).length !== 2 || source.split(current + listener).length !== 2) throw new Error('Original GLOBAL OAuth callback binding changed; reconcile cold and warm callback delivery before building.');
  return source.replace(bridge, wake).replace(current + listener, listener + current);
}

export function patchMacPanelAssetHost(source, assetsOrigin) {
  const tree = parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
  const targets = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ObjectExpression' && ['streamId', 'assetsJsonTs', 'atlasList'].every(key => node.properties.some(property => property.key?.name === key))) {
      const property = node.properties.find(property => property.key?.name === 'assetsCdnHost');
      if (property) targets.push(property.value);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(tree);
  if (targets.length !== 1) throw new Error('Original panel asset snapshot changed; reconcile Gallery image loading before building.');
  const value = targets[0], host = source.slice(value.start, value.end);
  return source.slice(0, value.start) + `(${host}&&${host}!=="__local_role_assets__"?${host}:${JSON.stringify(assetsOrigin)})` + source.slice(value.end);
}

export function patchMacLayoutBarriers(source) {
  const tree = parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
  const targets = [];
  function visit(node, callback) {
    if (!node || typeof node !== 'object') return;
    callback(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, callback));
      else if (value && typeof value === 'object') visit(value, callback);
    }
  }
  visit(tree, node => {
    if (node.type !== 'FunctionDeclaration') return;
    const content = source.slice(node.start, node.end);
    if (content.includes('[taskbar-insets] desktop state refresh failed')
      || (content.includes('[main-window-bounds] sync failed') && content.includes('syncMainWindowContentBoundsNow'))) targets.push(node);
  });
  if (targets.length !== 2) throw new Error('Original desktop layout barriers changed; reconcile macOS layout before building.');
  const frames = [];
  for (const target of targets) {
    const matches = [];
    visit(target.body, node => {
      if (node.type === 'AwaitExpression' && node.argument.type === 'NewExpression'
        && node.argument.callee.type === 'Identifier' && node.argument.callee.name === 'Promise'
        && source.slice(node.argument.start, node.argument.end).includes('requestAnimationFrame')) matches.push(node);
    });
    if (matches.length !== 1) throw new Error('Original desktop layout frame changed; reconcile macOS layout before building.');
    frames.push(matches[0]);
  }
  for (const frame of frames.sort((a, b) => b.start - a.start)) source = source.slice(0, frame.start) + 'await __wuwatappoMacLayoutBarrier()' + source.slice(frame.end);
  const helper = `async function __wuwatappoMacLayoutBarrier(){
  const nativeWindow=window.__TAURI__.window.getCurrentWindow();
  const [size,scale]=await Promise.all([nativeWindow.innerSize(),nativeWindow.scaleFactor()]);
  const root=document.documentElement;
  if(!root)throw new Error("macOS DOM layout root is unavailable");
  getComputedStyle(root).getPropertyValue("--pet-scale");
  const rootRect=root.getBoundingClientRect();
  const dockRect=document.querySelector(".pet-dock")?.getBoundingClientRect();
  const width=window.innerWidth,height=window.innerHeight;
  if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||!Number.isFinite(size.width)||!Number.isFinite(size.height)||Math.abs(width-size.width/scale)>2||Math.abs(height-size.height/scale)>2)throw new Error("macOS layout viewport does not match native window");
  for(const rect of[rootRect,dockRect])if(rect&&![rect.left,rect.top,rect.width,rect.height].every(Number.isFinite))throw new Error("macOS DOM layout geometry is invalid");
}`;
  return helper + source;
}

export function patchMacChestClock(source) {
  // WebKit's performance clock excludes Mac sleep. Keep the server offset,
  // but measure chest deadlines with wall time so they catch up after wake.
  const anchors = [
    'function fg(n){return typeof n!="number"||!Number.isFinite(n)||n<=0?!1:(Ys=n,dd=performance.now(),!0)}',
    'function is(){return Ys===null?Date.now():Ys+(performance.now()-dd)}',
    'const e=is(),t=performance.now();Nt.value=kr===null?',
    'function Cp(e){const t=performance.now()+fr;',
  ];
  for (const anchor of anchors) {
    if (source.split(anchor).length !== 2) throw new Error('Original chest clock changed; reconcile sleep-aware countdowns before building.');
    source = source.replace(anchor, anchor.replace('performance.now()', 'Date.now()'));
  }
  return source;
}
import { parse } from 'acorn';
