/**
 * test/live-session-title.test.mjs
 *
 * Integration tests for live.js session tab title behavior:
 *   - openSession directory extraction with and without trailing slash
 *   - First user prompt formats project session title and subsequent prompts keep it
 *   - Standalone session numbering re-allocates PiDesk when unassigned
 *   - session_info_update event updates tab title via savedSessionId / active fallback
 *   - Slash commands (/plan, /compact, /review) and file-only mentions do not title or lock tabs
 *
 * Run: node --test test/live-session-title.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
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
  beforeEach(async () => {
    // Reset sessions to a clean single standalone state to ensure zero order dependence
    const sessions = bridge.getSessions();
    for (const s of sessions) {
      await bridge.closeSession(s.id);
    }
  });

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
    assert.equal(titledSession.titleLocked, true);
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
    // Clean initial session is PiDesk
    const initial = bridge.getSessions().find(s => !s.path);
    assert.ok(initial);
    assert.equal(initial.name, 'PiDesk');
    await bridge.activateSession(initial.id);

    // User prompt customizes the title
    bridge._handleEvent({
      type: 'message_start',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Write a quick python script' }],
      },
    });
    assert.equal(getSession(initial.id).name, 'Write a quick python script');

    // Open a second standalone session — since no session is named "PiDesk", it should recycle "PiDesk", NOT "PiDesk (2)"
    const id2 = await bridge.openSession(null);
    assert.equal(getSession(id2).name, 'PiDesk');

    // Open a third standalone session while "PiDesk" is occupied — should be "PiDesk (2)"
    const id3 = await bridge.openSession(null);
    assert.equal(getSession(id3).name, 'PiDesk (2)');
  });

  it('session_info_update event updates tab title and marks titleLocked', async () => {
    const id = await bridge.openSession('/workspace/test-repo');
    await bridge.activateSession(id);

    // Simulate omp emitting session_info_update with omp's own sessionId
    bridge._handleEvent({
      type: 'session_info_update',
      title: 'Renamed from slash command',
      sessionId: 'omp-session-uuid-1234',
    });

    const session = getSession(id);
    assert.equal(session.name, 'test-repo: Renamed from slash command');
    assert.equal(session.titleLocked, true);
    assert.equal(session.userTitled, true);
    // Fallback to the active tab must not bind an unmatched omp id to it.
    assert.ok(!session.savedSessionId);
  });

  it('session_info_update matches by savedSessionId across tabs', async () => {
    const id = await bridge.openSession('/workspace/saved-repo');
    const entry = getSession(id);
    entry.savedSessionId = 'omp-target-777';

    // Switch away to another tab
    const otherId = await bridge.openSession(null);
    await bridge.activateSession(otherId);

    bridge._handleEvent({
      type: 'session_info_update',
      title: 'Updated from background omp',
      sessionId: 'omp-target-777',
    });

    const targetSession = getSession(id);
    assert.equal(targetSession.name, 'saved-repo: Updated from background omp');
    assert.equal(targetSession.titleLocked, true);
  });

  it('slash commands and file-only mentions do not set or lock tab title', async () => {
    const id = await bridge.openSession('/workspace/planning-project');
    await bridge.activateSession(id);
    assert.equal(getSession(id).name, 'planning-project');

    // 1. Send slash command
    bridge._handleEvent({
      type: 'message_start',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '/plan design auth flow' }],
      },
    });
    // Tab title should NOT change and titleLocked should NOT be set
    assert.equal(getSession(id).name, 'planning-project');
    assert.equal(Boolean(getSession(id).titleLocked), false);

    // 2. Send file-only mention
    bridge._handleEvent({
      type: 'message_start',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '@src/auth.js @"config/auth.json"' }],
      },
    });
    assert.equal(getSession(id).name, 'planning-project');
    assert.equal(Boolean(getSession(id).titleLocked), false);

    // 3. Send normal prompt with file mention
    bridge._handleEvent({
      type: 'message_start',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '@src/auth.js Implement JWT expiration refresh' }],
      },
    });
    // Now it should format and lock
    assert.equal(getSession(id).name, 'planning-project: Implement JWT expiration refresh');
    assert.equal(getSession(id).titleLocked, true);
  });
});
