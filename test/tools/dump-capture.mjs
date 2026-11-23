/** Print a compact view of a captured ask jsonl: node test/tools/dump-capture.mjs <file> */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node test/tools/dump-capture.mjs <captured.jsonl>");
  process.exit(2);
}
const show = (v) => JSON.stringify(v ?? "").slice(0, 170);
for (const line of readFileSync(file, "utf8").trim().split("\n")) {
  const o = JSON.parse(line);
  if (o.meta) { console.log("meta", show({ ...o.meta, prompt: String(o.meta.prompt).slice(0, 40) })); continue; }
  const f = o.frame;
  const body = f.options ?? f.args ?? f.value ?? (f.cancelled ? "cancelled" : "");
  const cps = (f.options ?? []).filter(x => /Done selecting/i.test(x)).map(x => [...x.slice(0, x.indexOf("Done"))].map(c => c.codePointAt(0).toString(16)));
  console.log(o.dir, f.type.replace("extension_ui_", ""), f.method ?? "", show(f.title), show(body), cps.length ? `doneGlyph=${show(cps[0])}` : "", f.optionDetails ? "optionDetails" : "");
}
