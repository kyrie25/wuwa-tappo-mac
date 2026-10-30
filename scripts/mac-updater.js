(() => {
  let pending;
  let dialog;
  let displayedVersion;
  const invoke = (command, args = {}) => window.__TAURI_INTERNALS__.invoke(command, args);
  const field = name => dialog.querySelector(`[data-update="${name}"]`);
  const message = error => typeof error === 'string' ? error : error?.message || 'Could not check for updates. Try again.';

  function show() {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'wuwatappo-mac-update';
      dialog.className = 'locale-en';
      dialog.setAttribute('aria-labelledby', 'wuwatappo-update-title');
      dialog.innerHTML = `<style>
        #wuwatappo-mac-update{box-sizing:border-box;width:min(520px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow:auto;border:3px solid #995e3f;border-radius:48px;padding:28px 32px 32px;background:#fef1d9 var(--mac-update-background,none) center/cover no-repeat;color:#8e5e43;font:14px/1.6 var(--font-main,inherit);box-shadow:0 8px 32px #5c403033}
        #wuwatappo-mac-update::backdrop{background:#00000059}#wuwatappo-mac-update h2{font-family:var(--font-bold,inherit);font-size:24px;line-height:1.3;margin:0 0 12px}#wuwatappo-mac-update p{margin:12px 0;overflow-wrap:anywhere}
        #wuwatappo-mac-update [data-update="installed"]{color:#8e7b6a}#wuwatappo-mac-update [data-update="status"]{font-weight:700}#wuwatappo-mac-update [data-update="instructions"],#wuwatappo-mac-update [data-update="asset"]{font-size:13px;color:#8e7b6a}
        #wuwatappo-mac-update pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;color:#5c4030;max-height:160px;overflow:auto;background:#fef6dd;border:2px solid #ebce9b;padding:12px 14px;border-radius:18px;margin:16px 0}
        #wuwatappo-mac-update footer{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:24px}#wuwatappo-mac-update button{box-sizing:border-box;flex:1 1 160px;min-height:44px;padding:6px 16px;border:2px solid #ebce9b;border-radius:22px;background:#ffe0a9;color:#8e5e43;box-shadow:0 2px #ebce9b;font:700 16px/1.4 var(--font-bold,inherit);cursor:pointer}
        #wuwatappo-mac-update button[data-update="download"],#wuwatappo-mac-update button[data-update="retry"]{background:#c88865;color:#fdf9ed;border-color:#995e3f;box-shadow:0 2px #995e3f}#wuwatappo-mac-update button:focus-visible{outline:3px solid #8e5e43;outline-offset:3px}#wuwatappo-mac-update button:active{transform:translateY(2px);box-shadow:none}#wuwatappo-mac-update button:disabled{opacity:.5;cursor:wait}
        #wuwatappo-mac-update::-webkit-scrollbar,#wuwatappo-mac-update pre::-webkit-scrollbar{width:4px;background:#eed4b8;border-radius:4px}#wuwatappo-mac-update::-webkit-scrollbar-thumb,#wuwatappo-mac-update pre::-webkit-scrollbar-thumb{background:#ffdca8;border-radius:4px}
        @media(max-width:420px){#wuwatappo-mac-update{width:calc(100vw - 24px);max-height:calc(100vh - 24px);padding:24px;border-radius:32px}#wuwatappo-mac-update h2{font-size:22px}}
      </style><h2 id="wuwatappo-update-title" data-update="title">Check for Updates</h2>
      <p data-update="installed"></p><p data-update="status" role="status" aria-live="polite"></p>
      <pre data-update="notes" hidden></pre>
      <p data-update="instructions" hidden>Download the package, quit this app normally, then replace the same regional app in Applications. Your settings, counters and login-storage preference stay in their existing locations.</p>
      <p data-update="asset" hidden></p>
      <footer><button data-update="retry" hidden>Try Again</button><button data-update="release" hidden>Release Notes</button><button data-update="download" hidden>Download</button><button data-update="close">Close</button></footer>`;
      document.body.append(dialog);
      field('close').onclick = () => dialog.close();
      field('retry').onclick = () => check({ interactive: true });
      for (const [name, action] of [['release', 'notes'], ['download', 'download']]) {
        field(name).onclick = async () => {
          field(name).disabled = true;
          try {
            await invoke('open_mac_update', { action, version: displayedVersion });
            field('status').textContent = action === 'download' ? 'Download opened in your browser. Quit this app before replacing it.' : 'Release notes opened in your browser.';
          } catch (error) { field('status').textContent = message(error); field('retry').hidden = false; }
          finally { field(name).disabled = false; }
        };
      }
    }
    displayedVersion = undefined;
    for (const name of ['retry', 'release', 'download', 'notes', 'instructions', 'asset']) field(name).hidden = true;
    field('title').textContent = 'Checking for Updates';
    field('status').textContent = 'Checking this fork’s GitHub Releases…';
    if (!dialog.open) dialog.showModal();
  }

  function render(info) {
    field('installed').textContent = info.currentVersion
      ? `Installed: v${info.currentVersion}` : `Development build · official resources v${info.resourceVersion}`;
    if (info.status === 'upToDate') {
      field('title').textContent = 'You’re Up to Date';
      field('status').textContent = `No newer fork release is available for v${info.currentVersion}.`;
    } else if (info.status === 'noRelease') {
      field('title').textContent = 'No Published Mac Release';
      field('status').textContent = 'This fork has no published stable Mac release yet. Try again later.';
    } else {
      field('title').textContent = info.status === 'development' ? 'Latest Published Release' : 'Update Available';
      field('status').textContent = info.status === 'development'
        ? `Latest release: v${info.release.version}. This development build has no release identity to compare.`
        : `Available: v${info.release.version}`;
      displayedVersion = info.release.version;
      field('notes').textContent = info.release.notes;
      field('asset').textContent = info.release.assetName;
      field('download').textContent = info.release.assetName.endsWith('.dmg') ? 'Download DMG' : 'Download ZIP';
      for (const name of ['release', 'download', 'notes', 'instructions', 'asset']) field(name).hidden = false;
    }
  }

  async function check({ interactive = false } = {}) {
    if (interactive) show();
    const request = pending ??= Promise.resolve().then(() => invoke('check_app_update'));
    try {
      const identity = Promise.resolve().then(() => invoke('get_mac_build_info')).then(build => {
        if (interactive) field('installed').textContent = build.forkVersion
          ? `Installed: v${build.forkVersion}` : `Development build · official resources v${build.resourceVersion}`;
      });
      const [info] = await Promise.all([request, identity]);
      if (interactive) render(info);
      if (info.status === 'upToDate') return { kind: 'none', currentVersion: info.currentVersion };
      return { kind: 'external', message: info.release ? `Latest fork release: v${info.release.version}. Download it from the update dialog.` : 'No published Mac release is available.' };
    } catch (error) {
      const text = message(error);
      if (interactive) {
        field('title').textContent = 'Could Not Check for Updates';
        field('status').textContent = text;
        field('retry').hidden = false;
      }
      return { kind: 'error', message: text };
    } finally { if (pending === request) pending = undefined; }
  }

  Object.defineProperty(window, '__WUWATAPPO_UPDATER__', { value: Object.freeze({ check }) });
})();
