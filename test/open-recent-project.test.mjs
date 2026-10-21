/**
 * test/open-recent-project.test.mjs
 *
 * Tests for openSession multi-tab creation and sequence numbering for the same project.
 *
 * Run: node --test test/open-recent-project.test.mjs
 */

import { describe, it, after } from 'node:test';
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

loadScript('peer-session.js');
loadScript('app/undo-message.js');
loadScript('undo-bridge.js');
loadScript('app/session-title.js');
loadScript('live.js');

const bridge = globalThis.OMP_BRIDGE;

describe('live.js — openSession multiple tabs for the same project', () => {
  const projPath = 'C:\\Projects\\my-service';

  it('assigns folder name to first session and sequence numbers to subsequent sessions', async () => {
    // 1. Open first session for my-service
    const id1 = await bridge.openSession(projPath);
    assert.ok(id1);
    let sessions = bridge.getSessions();
    const tab1 = sessions.find(s => s.id === id1);
    assert.ok(tab1);
    assert.equal(tab1.name, 'my-service');
    assert.equal(tab1.path, projPath);

    // 2. Open second session for the exact same path
    const id2 = await bridge.openSession(projPath);
    assert.ok(id2);
    assert.notEqual(id1, id2, 'Each openSession must return a distinct sessionId');
    sessions = bridge.getSessions();
    const tab2 = sessions.find(s => s.id === id2);
    assert.ok(tab2);
    assert.equal(tab2.name, 'my-service (2)');
    assert.equal(tab2.path, projPath);

    // 3. Open third session for the same path
    const id3 = await bridge.openSession(projPath);
    sessions = bridge.getSessions();
    const tab3 = sessions.find(s => s.id === id3);
    assert.ok(tab3);
    assert.equal(tab3.name, 'my-service (3)');

    // 4. Close session 2 (id2), next open should reuse (2)
    bridge.closeSession(id2);
    const id4 = await bridge.openSession(projPath);
    sessions = bridge.getSessions();
    const tab4 = sessions.find(s => s.id === id4);
    assert.ok(tab4);
    assert.equal(tab4.name, 'my-service (2)');

    // Clean up
    bridge.closeSession(id1);
    bridge.closeSession(id3);
    bridge.closeSession(id4);
  });

  it('normalizes path slashes when calculating sequence numbers', async () => {
    const slashVariant1 = 'D:/work/api-gateway';
    const slashVariant2 = 'D:\\work\\api-gateway';

    const idA = await bridge.openSession(slashVariant1);
    const idB = await bridge.openSession(slashVariant2);

    const sessions = bridge.getSessions();
    const tabA = sessions.find(s => s.id === idA);
    const tabB = sessions.find(s => s.id === idB);

    assert.equal(tabA.name, 'api-gateway');
    assert.equal(tabB.name, 'api-gateway (2)');

    bridge.closeSession(idA);
    bridge.closeSession(idB);
  });

  after(() => {
    const sessions = bridge.getSessions();
    for (const s of sessions) {
      bridge.closeSession(s.id);
    }
  });
});
