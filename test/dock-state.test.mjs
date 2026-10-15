import { test } from "node:test";
import assert from "node:assert/strict";
import { DockState } from "./helpers/shim.mjs";

const { KEY, defaults, normalizeDockState, loadDockState, saveDockState } = DockState;

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    dump: () => Object.fromEntries(m),
  };
}

test("defaults: files open, dock open on overview", () => {
  assert.deepEqual(defaults(), {
    filesOpen: true, filesWidth: 240, dockOpen: true, dockTab: "overview", dockWidth: 280,
  });
});

test("normalize keeps valid fields and clamps widths", () => {
  const s = normalizeDockState({ filesOpen: false, dockOpen: false, dockTab: "plan", filesWidth: 10, dockWidth: 5000 });
  assert.equal(s.filesOpen, false);
  assert.equal(s.dockOpen, false);
  assert.equal(s.dockTab, "plan");
  assert.equal(s.filesWidth, 160);
  assert.equal(s.dockWidth, 520);
});

test("normalize drops invalid fields back to defaults", () => {
  const s = normalizeDockState({ filesOpen: "yes", dockTab: "nope", filesWidth: "wide", dockWidth: null });
  assert.deepEqual(s, defaults());
  assert.deepEqual(normalizeDockState(null), defaults());
  assert.deepEqual(normalizeDockState("x"), defaults());
});

test("load: empty storage gives defaults", () => {
  assert.deepEqual(loadDockState(memStorage()), defaults());
  assert.deepEqual(loadDockState(null), defaults());
});

test("load: corrupt JSON falls back to defaults", () => {
  assert.deepEqual(loadDockState(memStorage({ [KEY]: "{not json" })), defaults());
});

test("load: migrates legacy files-panel keys", () => {
  const s = loadDockState(memStorage({
    "pidesk:files-panel-open": "false",
    "pidesk:files-panel-width": "320",
  }));
  assert.equal(s.filesOpen, false);
  assert.equal(s.filesWidth, 320);
  assert.equal(s.dockOpen, true);
});

test("load: bad legacy values are ignored", () => {
  const s = loadDockState(memStorage({
    "pidesk:files-panel-open": "maybe",
    "pidesk:files-panel-width": "abc",
  }));
  assert.deepEqual(s, defaults());
});

test("load: new key wins over legacy keys", () => {
  const st = memStorage({
    [KEY]: JSON.stringify({ filesOpen: true, filesWidth: 200 }),
    "pidesk:files-panel-open": "false",
    "pidesk:files-panel-width": "500",
  });
  const s = loadDockState(st);
  assert.equal(s.filesOpen, true);
  assert.equal(s.filesWidth, 200);
});

test("save then load round-trips", () => {
  const st = memStorage();
  const state = { filesOpen: false, filesWidth: 300, dockOpen: true, dockTab: "plan", dockWidth: 360 };
  assert.equal(saveDockState(st, state), true);
  assert.deepEqual(loadDockState(st), state);
});

test("save reports failure when storage throws or is missing", () => {
  const broken = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  assert.equal(saveDockState(broken, defaults()), false);
  assert.equal(saveDockState(null, defaults()), false);
});

test("layoutForDisplay: rail with a closed dock reads as focus", () => {
  assert.equal(DockState.layoutForDisplay("rail", false), "focus");
  assert.equal(DockState.layoutForDisplay("rail", true), "rail");
});

test("layoutForDisplay: split and focus are never remapped", () => {
  assert.equal(DockState.layoutForDisplay("split", false), "split");
  assert.equal(DockState.layoutForDisplay("split", true), "split");
  assert.equal(DockState.layoutForDisplay("focus", true), "focus");
  assert.equal(DockState.layoutForDisplay("rail", undefined), "rail");
});
