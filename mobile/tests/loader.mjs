// Loader cho kiem thu don vi app bang node:test (khong can thiet bi / Expo):
//  - 'react-native' -> ban gia toi thieu (Platform, AppState)
//  - import tuong doi khong duoi ('../theme') -> them .js / index.js nhu Metro
import { statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STUBS = {
  'react-native': `
    export const Platform = { get OS() { return globalThis.__RN_OS__ || 'android'; }, select: (o) => o[globalThis.__RN_OS__ || 'android'] ?? o.default };
    export const AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
    export const Alert = { alert: (...a) => (globalThis.__nativeAlerts ||= []).push(a) };`,
};
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

export async function resolve(spec, ctx, next) {
  if (STUBS[spec]) return { url: `data:text/javascript,${encodeURIComponent(STUBS[spec])}`, shortCircuit: true };
  if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL?.startsWith('file:') && !ctx.parentURL.includes('/tests/')) {
    const p = fileURLToPath(new URL(spec, ctx.parentURL));
    for (const cand of [p, `${p}.js`, `${p}/index.js`]) {
      if (isFile(cand)) return { url: pathToFileURL(cand).href, format: 'module', shortCircuit: true };
    }
  }
  return next(spec, ctx);
}

// Ma nguon app la ES module (duoi .js, package khong khai bao "type") -> bao Node doc dang module
export async function load(url, ctx, next) {
  if (url.startsWith('file:') && url.includes('/src/') && url.endsWith('.js')) return next(url, { ...ctx, format: 'module' });
  return next(url, ctx);
}
