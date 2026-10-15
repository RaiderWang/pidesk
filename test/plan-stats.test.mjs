import { test } from "node:test";
import assert from "node:assert/strict";
import { PlanStats } from "./helpers/shim.mjs";

const { derivePhase, summarizePlan, groupTasksByStatus } = PlanStats;

const board = (...statuses) => [{ title: "A", tasks: statuses.map((status, i) => ({ id: i, status })) }];

test("derivePhase: empty plan is idle unless the agent is streaming", () => {
  assert.equal(derivePhase(0, 0, false), "idle");
  assert.equal(derivePhase(0, 0, true), "running");
});

test("derivePhase: all tasks done wins over streaming", () => {
  assert.equal(derivePhase(3, 3, true), "done");
  assert.equal(derivePhase(3, 3, false), "done");
});

test("derivePhase: partial plan is running when streaming, queued otherwise", () => {
  assert.equal(derivePhase(3, 1, true), "running");
  assert.equal(derivePhase(3, 1, false), "queued");
});

test("derivePhase: valid override wins, invalid override is ignored", () => {
  assert.equal(derivePhase(3, 1, false, "done"), "done");
  assert.equal(derivePhase(3, 1, false, "bogus"), "queued");
});

test("summarizePlan counts statuses across columns and rounds percent", () => {
  const kanban = [
    { title: "A", tasks: [{ status: "done" }, { status: "in_progress" }] },
    { title: "B", tasks: [{ status: "pending" }] },
  ];
  assert.deepEqual(summarizePlan(kanban, { isStreaming: true }), {
    total: 3, done: 1, inProg: 1, pending: 1, percent: 33, phase: "running",
  });
});

test("summarizePlan tolerates empty / missing input", () => {
  assert.equal(summarizePlan([], {}).total, 0);
  assert.equal(summarizePlan(undefined).phase, "idle");
  assert.equal(summarizePlan([{ title: "x" }]).total, 0);
});

test("summarizePlan reports done at 100%", () => {
  const s = summarizePlan(board("done", "done"), {});
  assert.equal(s.phase, "done");
  assert.equal(s.percent, 100);
});

test("groupTasksByStatus buckets tasks and tags the column title", () => {
  const g = groupTasksByStatus([
    { title: "A", tasks: [{ id: 1, status: "pending" }, { id: 2, status: "done" }] },
    { title: "B", tasks: [{ id: 3, status: "in_progress" }, { id: 4, status: "pending" }] },
  ]);
  assert.deepEqual(g.live.map((t) => t.id), [3]);
  assert.deepEqual(g.pending.map((t) => t.id), [1, 4]);
  assert.deepEqual(g.done.map((t) => t.id), [2]);
  assert.equal(g.pending[1].column, "B");
});
