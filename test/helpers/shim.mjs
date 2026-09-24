/**
 * test/helpers/shim.mjs
 *
 * Browser environment shim for running IIFE source scripts in the Node.js
 * built-in test runner.  Sets globalThis.window = globalThis, stubs
 * localStorage / CustomEvent / event bus, loads source scripts in the same
 * dependency order as src/index.html, then re-exports every function placed
 * on window by those scripts.
 *
 * No npm dependencies required — runs with `node --test`.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '../../src');

// ── Global shims — must run before any source script is loaded ─────────────

// Make `window` available as a bare global (mirrors the browser environment).
globalThis.window = globalThis;

// In-memory localStorage shim (i18n.js reads saved locale at init time).
const _store = new Map();
globalThis.localStorage = {
  getItem:    (k)    => (_store.has(k) ? _store.get(k) : null),
  setItem:    (k, v) => { _store.set(k, String(v)); },
  removeItem: (k)    => { _store.delete(k); },
  clear:      ()     => { _store.clear(); },
};

// CustomEvent shim (i18n.js dispatches "i18nchange" on locale switch).
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type   = type;
    this.detail = init.detail ?? null;
  }
};

// Minimal event bus (window.addEventListener / dispatchEvent).
const _bus = new Map();
globalThis.addEventListener    = (t, fn) => {
  if (!_bus.has(t)) _bus.set(t, []);
  _bus.get(t).push(fn);
};
globalThis.removeEventListener = (t, fn) => {
  if (_bus.has(t)) _bus.set(t, _bus.get(t).filter(f => f !== fn));
};
globalThis.dispatchEvent       = (ev) => {
  for (const h of (_bus.get(ev.type) ?? [])) h(ev);
  return true;
};

// ── Script loader ──────────────────────────────────────────────────────────
// Reads a source file and evaluates it via new Function so it runs in the
// global scope.  Inside the IIFE, bare references like `window`, `localStorage`
// resolve to globalThis.* which we've already set up above.

function loadScript(rel) {
  const code = readFileSync(join(SRC, rel), 'utf-8');
  // eslint-disable-next-line no-new-func
  new Function(code)();
}

// ── Load scripts — same dependency order as src/index.html ────────────────
// model-names must precede adapter (window.MODEL_NAMES dependency).
loadScript('model-names.js');
loadScript('adapter.js');
loadScript('design/yaml-util.js');
loadScript('i18n.js');

// ── Re-export everything placed on window by the source scripts ────────────

// adapter.js exports (via Object.assign(window, {...}))
export const {
  normalizeToolName,
  todoStatusToDesign,
  phaseStyle,
  derivePlanPhase,
  buildKanban,
  buildPlanMeta,
  formatTokens,
  buildCtx,
  formatModelId,
  buildActivityFromLog,
  buildToolStartCard,
  finalizeToolCard,
  updateToolCard,
  adaptAgentMessages,
  timeNow,
} = globalThis;

// yaml-util.js exports a namespace object (window.YamlUtil)
export const { parseModelsYaml, dumpModelsYaml, validateModelsYaml } = globalThis.YamlUtil;

// i18n.js exports window.I18N and window.t
export const { t, getLocale, setLocale } = globalThis.I18N;
