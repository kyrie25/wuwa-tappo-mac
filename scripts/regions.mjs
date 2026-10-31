const profiles = {
  cn: {
    id: 'cn', region: 'CN', label: 'CN',
    configUrl: 'https://api-mc-wuwatappo.kurogames-global.com/api/common/activity-config',
    assetsOrigin: 'https://mc-wuwatappo.kurogames-global.com',
    updaterHostFile: 'latest_host.json',
    upstreamLock: 'upstream-cn.json', frontendDir: 'frontend', preparedDir: 'build/frontend',
    iconsDir: 'src-tauri/icons', tauriConfig: null,
    productName: 'Wuwa Tappo', identifier: 'io.github.kyrie25.wuwatappo.cn.mac',
    artifactPrefix: 'WuwaTappo-CN-Mac',
  },
  global: {
    id: 'global', region: 'GLOBAL', label: 'Global',
    configUrl: 'https://api-wutheringwaves-wuwatappo.kurogames-global.com/api/common/activity-config',
    assetsOrigin: 'https://wutheringwaves-wuwatappo.kurogames-global.com',
    updaterHostFile: 'latest-global_host.json',
    upstreamLock: 'upstream-global.json', frontendDir: 'frontend-global', preparedDir: 'build/frontend-global',
    iconsDir: 'src-tauri/icons-global', tauriConfig: 'src-tauri/tauri.global.conf.json',
    productName: 'Wuwa Tappo', identifier: 'io.github.kyrie25.wuwatappo.global.mac',
    artifactPrefix: 'WuwaTappo-Global-Mac',
  },
};

export function getRegionProfile(id = process.env.WUWA_REGION || 'cn') {
  if (!Object.hasOwn(profiles, id)) throw new Error(`Unknown service region: ${id}. Choose cn or global.`);
  return profiles[id];
}
