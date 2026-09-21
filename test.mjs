// test.mjs — 独立の門（T36）。伏せた後のモジュールを実際に import して動かす。node test.mjs <module.mjs>
// 構造検査（原本一致・export 集合）とは別に、動くかどうかだけを見る。webpack の挙動は見ない（見えない）。
import { pathToFileURL } from "node:url";
const target = process.argv[2];
const expected = ["parse_amount_basic", "parse_amount_comma", "sum_ignores_null", "template_is_code"];
let mod;
try { mod = await import(pathToFileURL(target).href); }
catch (e) { console.log(JSON.stringify({ ok: false, stage: "import", error: String(e.message).split("\n")[0] })); process.exit(1); }
const registered = [];
const results = {};
mod.registerTests((name, fn) => { registered.push(name); try { results[name] = !!fn(); } catch (e) { results[name] = "throw:" + e.message; } });
const missing = expected.filter(n => !registered.includes(n));
const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
const r = { ok: missing.length === 0 && failed.length === 0, registered: registered.length, expected: expected.length, missing, failed,
  parseAmount: mod.parseAmount("1,200円"), sum: mod.sum(["100円", "x", "200円"]), pure: mod.PURE_VALUE };
console.log(JSON.stringify(r));
process.exit(r.ok ? 0 : 1);
