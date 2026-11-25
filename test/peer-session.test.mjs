/**
 * test/peer-session.test.mjs
 *
 * peer-session.js in isolation: tool_execution_start of the pinned peer must
 * not cut a bash command at its last "/" (activity + recentTools target).
 *
 * Run: node --test test/peer-session.test.mjs
 */

import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
const handlers = {};
globalThis.OMP_DATA = {};
globalThis.__TAURI__ = {
  event: { listen: (name, cb) => { handlers[name] = cb; return Promise.resolve(() => {}); } },
  core: { invoke: () => Promise.resolve() },
};
// eslint-disable-next-line no-new-func
new Function(readFileSync(join(SRC, 'peer-session.js'), 'utf-8'))();
const bridge = globalThis.PeerSessionBridge;

const toolStart = (toolName, args, toolCallId = 'c1') =>
  handlers['agent://line/s2']({
    payload: JSON.stringify({ type: 'tool_execution_start', toolCallId, toolName, args }),
  });

before(() => {
  bridge.init({ notify: () => {}, sessionRegistry: new Map([['s2', { name: 'proj' }]]) });
});

// Clears the 100 ms notify timer _handleLine arms, so the process can exit.
afterEach(() => bridge.unpin());

describe('peer-session — tool_execution_start target', () => {
  it('keeps a command ending in 2>/dev/null whole', async () => {
    bridge.pin('s2', 's1');
    await new Promise(r => setTimeout(r, 0));
    const cmd = 'cat f | iconv -f gbk -t utf-8 2>/dev/null';
    toolStart('bash', { command: cmd });
    const peer = bridge.build();
    assert.equal(peer.activity, `bash · ${cmd}`);
    assert.equal(peer.recentTools[0].target, cmd);
  });

  it('shows the basename for a path', async () => {
    bridge.pin('s2', 's1');
    await new Promise(r => setTimeout(r, 0));
    toolStart('read', { path: 'C:\\proj\\src\\main.rs' });
    const peer = bridge.build();
    assert.equal(peer.activity, 'read · main.rs');
    assert.equal(peer.recentTools[0].target, 'main.rs');
  });

  it('shows just the tool name when there is no target', async () => {
    bridge.pin('s2', 's1');
    await new Promise(r => setTimeout(r, 0));
    toolStart('bash', {});
    assert.equal(bridge.build().activity, 'bash');
  });
});
