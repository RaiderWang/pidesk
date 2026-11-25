/**
 * test/helpers/load-live.mjs
 *
 * Loads live.js together with the `src/live/*` modules it depends on, in the
 * same order as src/index.html (guarded by test/live-load-order.test.mjs).
 *
 * `loadLive()` is a function on purpose: tests must be able to set
 * `window.__TAURI__` / other stubs *before* live.js runs its bootstrap, so
 * nothing executes at import time. Bridge scripts that live.js needs
 * (peer-session, undo-bridge, ...) stay the responsibility of each test.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src');

/** Ordered `src/`-relative scripts: live/* modules first, live.js last. */
export const LIVE_PARTS = [
  'live/defaults.js',
  'live/prefs.js',
  'live/tauri-api.js',
  'live/custom-models.js',
  'live/runtime.js',
  'live/todo-phases.js',
  'live/tab-titles.js',
  'live/events-ui.js',
  'live/events-tool.js',
  'live/events-message.js',
  'live/models.js',
  'live/response-handlers.js',
  'live/session-switch.js',
  'live/sessions.js',
  'live/session-branch.js',
  'live/window-chrome.js',
  'live.js',
];

export function loadLive() {
  for (const rel of LIVE_PARTS) {
    // eslint-disable-next-line no-new-func
    new Function(readFileSync(join(SRC, rel), 'utf-8'))();
  }
}
