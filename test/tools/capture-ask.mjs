/**
 * test/tools/capture-ask.mjs — record the real `ask` tool frames of an omp RPC session.
 *
 * Spawns `omp --mode rpc` in a scratch directory, sends a prompt that makes the
 * model call the `ask` tool, answers every dialog with a scripted policy and
 * writes the ask-related frames to
 *   test/fixtures/captured/ask-<omp version>-<scenario>.jsonl
 * which test/ask-captured.test.mjs replays against live.js.
 *
 * Usage:
 *   node test/tools/capture-ask.mjs --scenario idea|single|multi|other|multi-other
 *   node test/tools/capture-ask.mjs --prompt "<text>" [--answers first|<json array>] [--name foo]
 *   node test/tools/capture-ask.mjs --scenario idea --interactive
 *
 * Answer tokens (JSON array, consumed in order, falling back to `first`):
 *   "opt:N" pick display option N (0-based)   "other:TEXT" free text via the Other row
 *   "done"  press Done selecting              "text:TEXT"  answer an input/editor request
 *
 * Needs a configured model (uses a few tokens). Records no credentials.
 */

import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "fixtures", "captured");
const NO_TOOLS = "Do not use any other tool. After I answer, reply with one short sentence.";

const SCENARIOS = {
  // The user-written prompt that makes the model interview them (multi-question, many options).
  idea: {
    prompt: "我想做一个美妙的听书应用，在听书过程中播放可以无限循环的温馨视频，文字像字幕一样打在下方，用户可以投放到屏幕或电视上，营造舒适的听书体验。请通过向我提问的方式，帮我完善这个想法，形成完整的方案。",
    answers: "first",
  },
  single: {
    prompt: `Call the ask tool exactly once with ONE single-choice question "Pick a colour" and options "Red", "Green", "Blue". ${NO_TOOLS}`,
    answers: ["opt:1"],
  },
  multi: {
    prompt: `Call the ask tool exactly once with ONE multi-select question (multi: true) "Pick features" and options "Auth", "Billing", "Search". ${NO_TOOLS}`,
    answers: ["opt:0", "opt:2", "done"],
  },
  other: {
    prompt: `Call the ask tool exactly once with ONE single-choice question "Pick a colour" and options "Red", "Green", "Blue". ${NO_TOOLS}`,
    answers: ["other:Teal"],
  },
  "multi-other": {
    prompt: `Call the ask tool exactly once with ONE multi-select question (multi: true) "Pick features" and options "Auth", "Billing", "Search". ${NO_TOOLS}`,
    answers: ["opt:0", "other:Custom feature", "done"],
  },
};

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const interactive = argv.includes("--interactive");
const verbose = argv.includes("--verbose");
const scenarioName = arg("scenario");
const scenario = scenarioName ? SCENARIOS[scenarioName] : undefined;
if (scenarioName && !scenario) {
  console.error(`unknown scenario '${scenarioName}'. Known: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(2);
}
const prompt = arg("prompt") ?? scenario?.prompt;
if (!prompt) {
  console.error("need --scenario <name> or --prompt <text> (see header of this file)");
  process.exit(2);
}
const rawAnswers = arg("answers");
let script = rawAnswers && rawAnswers !== "first" ? JSON.parse(rawAnswers) : (scenario?.answers ?? "first");
if (script === "first") script = [];
const name = arg("name") ?? scenarioName ?? "custom";
const timeoutMs = Number(arg("timeout") ?? 240) * 1000;
const MAX_RESPONSES = 40;

const version = (() => {
  try { return execFileSync("omp", ["--version"], { encoding: "utf8" }).trim().replace(/^omp\//, ""); }
  catch { return "unknown"; }
})();

// ── recording ─────────────────────────────────────────────────────────────
const log = [{ meta: { omp: version, scenario: name, prompt, answers: [...script], startedAt: new Date().toISOString() } }];
const seen = [];                // arrival order summary for the printed report
let responses = 0;
const record = (dir, frame) => log.push({ dir, frame });

// ── process ───────────────────────────────────────────────────────────────
const cwd = mkdtempSync(join(tmpdir(), "pidesk-ask-capture-"));
// PiDesk (agent/spawn.rs) prefers `rpc-ui` when omp advertises it — `ask` only exists in that mode.
const mode = arg("mode") ?? (() => {
  try { return /rpc-ui/.test(execFileSync("omp", ["--help"], { encoding: "utf8" })) ? "rpc-ui" : "rpc"; }
  catch { return "rpc"; }
})();
const proc = spawn("omp", ["--mode", mode], { cwd, stdio: ["pipe", "pipe", "pipe"], shell: false });
proc.stderr.on("data", d => process.stderr.write(`[omp stderr] ${d}`));
proc.on("error", e => { console.error("spawn error:", e.message); process.exit(1); });
const send = (cmd) => proc.stdin.write(JSON.stringify(cmd) + "\n");

const DIALOG_METHODS = new Set(["select", "input", "editor", "confirm", "cancel"]);
const DONE_RE = /Done selecting/i;
const OTHER_RE = /^Other[\s\r]*\(type your own\)/i;
const normTitle = (t) => String(t ?? "").replace(/\(\d+ selected\)\s+/g, "").replace(/\s\(\d+\/\d+\)$/, "").trim();

let pendingOther = null;       // text to give the next input/editor after an Other pick
const titleCount = new Map();
const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
const ask = (q) => new Promise(res => rl.question(q, res));

function nextToken() { return script.length ? script.shift() : null; }

/** Decide the answer for a select frame → { value } | { other } */
async function chooseSelect(ev) {
  const options = ev.options ?? [];
  const otherRow = options.find(o => OTHER_RE.test(o));
  const doneRow = options.find(o => DONE_RE.test(o) && !OTHER_RE.test(o));
  const display = options.filter(o => o !== otherRow && o !== doneRow);
  const key = normTitle(ev.title);
  titleCount.set(key, (titleCount.get(key) ?? 0) + 1);

  let token = null;
  if (interactive) {
    console.log(`\n${ev.title}`);
    options.forEach((o, i) => console.log(`  ${i}) ${o}`));
    const line = (await ask("number | o:text | d(one) > ")).trim();
    token = /^\d+$/.test(line) ? `opt:${display.indexOf(options[Number(line)])}`
      : line.startsWith("o:") ? `other:${line.slice(2)}` : line === "d" ? "done" : null;
  } else {
    token = nextToken();
  }
  if (token === "done" && doneRow) return { value: doneRow };
  if (token?.startsWith("other:") && otherRow) return { value: otherRow, other: token.slice(6) };
  if (token?.startsWith("opt:") && display[Number(token.slice(4))] !== undefined) return { value: display[Number(token.slice(4))] };
  // Default policy: Done when offered; otherwise the first option; if the same question keeps coming
  // back with no Done row (18.x multi-select inside a multi-question ask), escape through Other.
  if (doneRow) return { value: doneRow };
  if (titleCount.get(key) >= 3 && otherRow) return { value: otherRow, other: "auto answer" };
  return { value: display[0] ?? options[0] };
}

async function handle(ev) {
  record("in", ev);
  if (ev.method === "select") {
    seen.push({ k: "select", fields: Object.keys(ev).filter(f => !["type", "id", "method"].includes(f)), title: ev.title, options: ev.options });
    const c = await chooseSelect(ev);
    pendingOther = c.other ?? null;
    reply(ev.id, { value: c.value });
  } else if (ev.method === "input" || ev.method === "editor") {
    seen.push({ k: ev.method, fields: Object.keys(ev).filter(f => !["type", "id", "method"].includes(f)), title: ev.title });
    let text = pendingOther;
    pendingOther = null;
    if (text === null && interactive) text = await ask(`${ev.method}: ${ev.title}\n> `);
    if (text === null) {
      const tok = nextToken();
      text = tok?.startsWith("text:") ? tok.slice(5) : "";
    }
    reply(ev.id, { value: text });
  } else if (ev.method === "cancel") {
    pendingOther = null;
  } else if (ev.method === "confirm") {
    reply(ev.id, { cancelled: true });
  }
}

function reply(id, body) {
  if (++responses > MAX_RESPONSES) { console.error("too many responses — giving up"); finish(1); return; }
  const frame = { type: "extension_ui_response", id, ...body };
  record("out", frame);
  send(frame);
}

// ── frame loop (serialised so interactive answers keep their order) ───────
let chain = Promise.resolve();
let askSeen = false;
let ended = false;
createInterface({ input: proc.stdout }).on("line", raw => {
  let ev;
  try { ev = JSON.parse(raw); } catch { return; }
  if (verbose && ev.type !== "message_update") console.log(`[evt] ${ev.type}${ev.method ? `/${ev.method}` : ""}${ev.toolName ? ` ${ev.toolName}` : ""}`);
  if (ev.type === "message_end" && ev.message?.role === "assistant") {
    const text = (ev.message.content ?? []).filter(c => c.type === "text").map(c => c.text).join(" ");
    if (text) console.log(`[assistant] ${text.slice(0, 300)}`);
  }
  if (ev.type === "message_end" && ev.message?.errorMessage) console.error(`[model error] ${ev.message.errorMessage}`);
  if (ev.type === "ready") { send({ type: "prompt", message: prompt }); return; }
  if (ev.type === "tool_execution_start" && ev.toolName === "ask") {
    askSeen = true;
    seen.push({ k: "tool_execution_start" });
    record("in", { type: ev.type, toolCallId: ev.toolCallId, toolName: ev.toolName, args: ev.args });
  } else if (ev.type === "tool_execution_end" && ev.toolName === "ask") {
    seen.push({ k: "tool_execution_end", isError: ev.isError });
    record("in", { type: ev.type, toolCallId: ev.toolCallId, toolName: ev.toolName, isError: ev.isError ?? false });
  } else if (ev.type === "tool_execution_start") {
    console.log(`[other tool] ${ev.toolName}`);
  } else if (ev.type === "extension_ui_request" && DIALOG_METHODS.has(ev.method)) {
    askSeen = true;
    chain = chain.then(() => handle(ev)).catch(e => console.error("handler error:", e));
  } else if (ev.type === "agent_end") {
    chain = chain.then(() => finish(askSeen ? 0 : 1));
  }
});

setTimeout(() => { console.error("timeout"); finish(askSeen ? 0 : 1); }, timeoutMs);
setTimeout(() => { if (!askSeen) { console.error("the model has not called ask after 120s"); } }, 120_000);

function finish(code) {
  if (ended) return;
  ended = true;
  try { proc.kill(); } catch { /* already gone */ }
  rl?.close();
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `ask-${version}-${name}.jsonl`);
  if (askSeen) writeFileSync(file, log.map(l => JSON.stringify(l)).join("\n") + "\n");
  report(askSeen ? file : null);
  process.exit(code);
}

function report(file) {
  console.log(`\n── capture summary (omp ${version}, scenario ${name}) ──`);
  const firstSelect = seen.findIndex(s => s.k === "select" || s.k === "input" || s.k === "editor");
  const start = seen.findIndex(s => s.k === "tool_execution_start");
  if (firstSelect >= 0 && start >= 0) {
    console.log(`first dialog frame came ${firstSelect < start ? "BEFORE" : "AFTER"} tool_execution_start`);
  }
  const fieldSets = new Set(seen.filter(s => s.fields).map(s => `${s.k}: ${s.fields.join(",")}`));
  console.log("frame field sets:"); fieldSets.forEach(f => console.log(`  ${f}`));
  const rounds = [...titleCount].filter(([, n]) => n > 1);
  console.log(`questions: ${titleCount.size}; repeated rounds: ${rounds.map(([t, n]) => `${n}x "${t.slice(0, 40)}"`).join("; ") || "none"}`);
  console.log(`methods: ${[...new Set(seen.map(s => s.k))].join(", ")}`);
  const recommended = seen.some(s => (s.options ?? []).some(o => /\(Recommended\)/.test(o)));
  console.log(`(Recommended) suffix seen: ${recommended}`);
  console.log(file ? `saved: ${file}` : "no ask frames seen — nothing saved");
}
