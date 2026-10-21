/**
 * test/live-session-title.test.mjs
 *
 * Integration tests for live.js session tab title behavior:
 *   - openSession directory extraction with and without trailing slash
 *   - First user prompt formats project session title and subsequent prompts keep it
 *   - Standalone session numbering re-allocates PiDesk when unassigned
 *   - session_info_update event updates tab title
 *
 * Run: node --test test/live-session-title.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import './helpers/shim.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '../src');

function loadScript(rel) {
  const code = readFileSync(join(SRC, rel), 'utf-8');
  new Function(code)();
}

// Load scripts in index.html order
loadScript('app/session-title.js');
loadScript('peer-session.js');
loadScript('app/undo-message.js');
loadScript('undo-bridge.js');
loadScript('live.js');

const bridge = globalThis.OMP_BRIDGE;

// Set up runtime __TAURI__ stub for bridge method calls
globalThis.window.__TAURI__ = {
  core: {
    invoke: async () => null,
  },
  event: {
    listen: async () => () => {},
  },
};

function getSession(id) {
  return bridge.getSessions().find(s => s.id === id);
}

describe('live.js — session title integration', () => {
  it('openSession with trailing slash extracts folderName instead of full path', async () => {
    const id = await bridge.openSession('F:/Project/my-project/');
    assert.ok(id);
    const session = getSession(id);
    assert.ok(session);
    assert.equal(session.name, 'my-project');
  });

  it('first user prompt formats project session title and subsequent prompts keep it', async () => {
    const id = await bridge.openSession('/workspace/billing-api');
    await bridge.activateSession(id);
    const initialSession = getSession(id);
    assert.equal(initialSession.name, 'billing-api');

    // First user message arrives via message_start
    bridge._handleEvent({
      type: 'message_start',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Refactor subscription renewal' }],
      },
    });

    const titledSession = getSession(id);
    assert.equal(titledSession.name, 'billing-api: Refactor subscription renewal');
    assert.equal(titledSession.userTitled, true);

    // Second user message arrives
    bridge._handleEvent({
      type: 'message_start',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Also add Stripe webhook retry' }],
      },
    });

    const secondTurnSession = getSession(id);
    // Should NOT be overwritten
    assert.equal(secondTurnSession.name, 'billing-api: Refactor subscription renewal');
  });

  it('standalone session numbering uses PiDesk when available, not jumping to (2)', async () => {
    // Open a standalone session
    const id1 = await bridge.openSession(null);
    await bridge.activateSession(id1);
    assert.equal(getSession(id1).name, 'PiDesk');

    // User prompt customizes the title
    bridge._handleEvent({
      type: 'message_start',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Write a quick python script' }],
      },
    });
    assert.equal(getSession(id1).name, 'Write a quick python script');

    // Open a second standalone session — since no session is named "PiDesk", it should be "PiDesk", NOT "PiDesk (2)"
    const id2 = await bridge.openSession(null);
    assert.equal(getSession(id2).name, 'PiDesk');

    // Open a third standalone session while "PiDesk" is occupied — should be "PiDesk (2)"
    const id3 = await bridge.openSession(null);
    assert.equal(getSession(id3).name, 'PiDesk (2)');
  });

  it('session_info_update event updates tab title and marks userTitled', async () => {
    const id = await bridge.openSession('/workspace/test-repo');
    await bridge.activateSession(id);

    bridge._handleEvent({
      type: 'session_info_update',
      title: 'Renamed from slash command',
      sessionId: id,
    });

    const session = getSession(id);
    assert.equal(session.name, 'test-repo: Renamed from slash command');
    assert.equal(session.userTitled, true);
  });
});
