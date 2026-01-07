/**
 * Even the resolveId hook cannot interfere with vite pre-build,
 * and adding query parameter virtual modules will also fail.
 * You can only proxy to the real file through alias
 */
/**
 * shared will be proxied:
 * 1. __prebuild__: export shareModule (pre-built source code of modules such as vue, react, etc.)
 * 2. __loadShare__: load shareModule (mfRuntime.loadShare('vue'))
 */

import { dirname, join } from 'path';
import { ShareItem } from '../utils/normalizeModuleFederationOptions';
import VirtualModule from '../utils/VirtualModule';
import { virtualRuntimeInitStatus } from './virtualRuntimeInitStatus';

// *** __prebuild__
const preBuildCacheMap: Record<string, VirtualModule> = {};
export const PREBUILD_TAG = '__prebuild__';
export function writePreBuildLibPath(pkg: string) {
  if (!preBuildCacheMap[pkg]) preBuildCacheMap[pkg] = new VirtualModule(pkg, PREBUILD_TAG);
  preBuildCacheMap[pkg].writeSync('');
}
export function getPreBuildLibImportId(pkg: string): string {
  if (!preBuildCacheMap[pkg]) preBuildCacheMap[pkg] = new VirtualModule(pkg, PREBUILD_TAG);
  const importId = preBuildCacheMap[pkg].getImportId();
  return importId;
}

// *** __loadShare__
export const LOAD_SHARE_TAG = '__loadShare__';

const loadShareCacheMap: Record<string, VirtualModule> = {};
export function getLoadShareModulePath(pkg: string): string {
  if (!loadShareCacheMap[pkg])
    loadShareCacheMap[pkg] = new VirtualModule(pkg, LOAD_SHARE_TAG, '.js');
  const filepath = loadShareCacheMap[pkg].getPath();
  return filepath;
}
export function writeLoadShareModule(pkg: string, shareItem: ShareItem, command: string) {
  loadShareCacheMap[pkg].writeSync(`

    ;() => import(${JSON.stringify(getPreBuildLibImportId(pkg))}).catch(() => {});
    // dev uses dynamic import to separate chunks
    ${command !== 'build' ? `;() => import(${JSON.stringify(pkg)}).catch(() => {});` : ''}
    const {loadShare} = require("@module-federation/runtime")
    const {initPromise} = require("${virtualRuntimeInitStatus.getImportId()}")
    const res = initPromise.then(_ => loadShare(${JSON.stringify(pkg)}, {
    customShareInfo: {shareConfig:{
      singleton: ${shareItem.shareConfig.singleton},
      strictVersion: ${shareItem.shareConfig.strictVersion},
      requiredVersion: ${JSON.stringify(shareItem.shareConfig.requiredVersion)}
    }}}))
    let exportModule = ${command !== 'build' ? '/*mf top-level-await placeholder replacement mf*/' : 'await '}res.then(factory => factory())
    module.exports = exportModule
  `);
}

export function writeLoadShareModuleESM(pkg: string, shareItem: ShareItem, command: string) {
  const vm = new VirtualModule(pkg);
  const mod = require(join(dirname(vm.getPath()), '..', pkg));
  loadShareCacheMap[pkg].writeSync(`

    ;() => import(${JSON.stringify(getPreBuildLibImportId(pkg))}).catch(() => {});
    // dev uses dynamic import to separate chunks
    ${command !== 'build' ? `;() => import(${JSON.stringify(pkg)}).catch(() => {});` : ''}
    import {loadShare} from "@module-federation/runtime"
    const {initPromise} = await import("${virtualRuntimeInitStatus.getImportId()}")
    
    const res = initPromise.then(_ => loadShare(${JSON.stringify(pkg)}, {
    customShareInfo: {shareConfig:{
      singleton: ${shareItem.shareConfig.singleton},
      strictVersion: ${shareItem.shareConfig.strictVersion},
      requiredVersion: ${JSON.stringify(shareItem.shareConfig.requiredVersion)},
      isEsm: true
    }}}))
    const moduleFactory = ${command === 'nope' ? '/* no mf top-level-await placeholder replacement mf here!*/' : 'await '}res.then(factory => factory())
    // ESM re-export instead of module.exports

${Object.keys(mod)
  .filter((key) => key !== 'default')
  .map((key) => `\tlet mf_${key} = moduleFactory.${key}`)
  .join(';\n')}

    export { ${Object.keys(mod)
      .filter((key) => key !== 'default')
      .map((key) => `mf_${key} as ${key}`)
      .join(', ')} };
    export default moduleFactory;
  `);
}
