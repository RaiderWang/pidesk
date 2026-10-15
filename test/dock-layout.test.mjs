import { test } from "node:test";
import assert from "node:assert/strict";
import { DockLayout } from "./helpers/shim.mjs";

const { buildStageColumns, resolveStageLayout, clamp, FILES, DOCK } = DockLayout;

test("session column only when nothing else is visible", () => {
  assert.equal(buildStageColumns({ activity: false }), "minmax(0, 1fr)");
});

test("activity bar adds a fixed 44px lead column", () => {
  assert.equal(buildStageColumns({}), "44px minmax(0, 1fr)");
});

test("files + dock around the session column", () => {
  assert.equal(
    buildStageColumns({ files: true, filesW: 260, dock: true, dockW: 300 }),
    "44px 260px minmax(0, 1fr) 300px",
  );
});

test("split peer sits between session and dock", () => {
  assert.equal(
    buildStageColumns({ files: true, filesW: 240, split: true, splitW: 320, dock: true, dockW: 280 }),
    "44px 240px minmax(0, 1fr) 320px 280px",
  );
  assert.equal(buildStageColumns({ split: true }), "44px minmax(0, 1fr) 320px");
});

test("widths are clamped to their ranges", () => {
  const r = resolveStageLayout({ files: true, filesW: 50, dock: true, dockW: 9999 });
  assert.equal(r.filesW, FILES.min);
  assert.equal(r.dockW, DOCK.max);
});

test("non-numeric widths fall back to defaults", () => {
  const r = resolveStageLayout({ files: true, filesW: "abc", dock: true, dockW: undefined });
  assert.equal(r.filesW, FILES.def);
  assert.equal(r.dockW, DOCK.def);
  assert.equal(clamp(NaN, FILES), FILES.def);
});

test("below 900px the files tree and dock auto-collapse", () => {
  const r = resolveStageLayout({ files: true, dock: true, split: true, width: 880 });
  assert.equal(r.files, false);
  assert.equal(r.dock, false);
  assert.equal(r.collapsed, true);
  assert.equal(r.split, true);
  assert.equal(r.columns, "44px minmax(0, 1fr) 280px"); // narrow split width
});

test("900px exactly does not collapse", () => {
  const r = resolveStageLayout({ files: true, dock: true, width: 900 });
  assert.equal(r.files, true);
  assert.equal(r.dock, true);
});

test("below 1100px the dock and split shrink to compact widths", () => {
  const r = resolveStageLayout({ dock: true, dockW: 400, split: true, splitW: 400, width: 1000 });
  assert.equal(r.dockW, 240);
  assert.equal(r.splitW, 280);
  assert.equal(r.columns, "44px minmax(0, 1fr) 280px 240px");
});

test("wide windows keep requested widths", () => {
  const r = resolveStageLayout({ dock: true, dockW: 400, width: 1600 });
  assert.equal(r.dockW, 400);
});

test("omitting width skips the responsive rules", () => {
  const r = resolveStageLayout({ files: true, dock: true });
  assert.equal(r.files, true);
  assert.equal(r.collapsed, false);
});
