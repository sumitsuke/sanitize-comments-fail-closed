// sanitize_and_check.mjs — 1 コマンド（T36）: 伏せる（sanitize_v2）→ 原本一致（verify_match・別パーサ）→ 独立の門（test）→ report.json に判定。
// node sanitize_and_check.mjs <in.mjs> <out_dir> [--test <test.mjs>]
// 判定: FAIL＝parse 不可／トークン不一致／export 不一致／行数が変わった／test 失敗
//       REVIEW＝構造は通ったが、コメント側に社内語が残っている（人が「残す」と裁定するまで納品しない）
//       PASS＝すべて緑。終了コード 0=PASS／3=REVIEW／1=FAIL（自動処理が REVIEW を PASS 扱いできない）
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const [src, outDir] = args;
const ti = args.indexOf("--test"); const testScript = ti >= 0 ? args[ti + 1] : null;
const run = (cmd) => spawnSync(process.execPath, cmd, { encoding: "utf8" });

const s = run([join(here, "sanitize_v2.mjs"), src, outDir]);
const sanitized = join(outDir, basename(src));
const rep = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8"));
const v = run([join(here, "verify_match.mjs"), src, sanitized]);
let vm = null; try { vm = JSON.parse(v.stdout.trim().split("\n").pop()); } catch { vm = { token_match: false, export_match: false, sanitized: { parse: false, error: "verify_match failed: " + (v.stderr || "").slice(0, 120) } }; }
let test = null;
if (testScript) {
  const t = run([testScript, sanitized]);
  try { test = JSON.parse(t.stdout.trim().split("\n").pop()); } catch { test = { ok: false, stage: "crash", error: (t.stdout + t.stderr).slice(0, 120) }; }
}
const reasons = [...(rep.reasons || [])];
if (!vm.sanitized?.parse) reasons.push("independent parser: sanitized output does not parse: " + (vm.sanitized?.error || ""));
if (!vm.token_match) reasons.push("code tokens differ from original (independent parser)");
if (!vm.export_match) reasons.push("export set differs: missing " + JSON.stringify(vm.missing_exports || []));
if (test && !test.ok) reasons.push("gate test failed: " + JSON.stringify({ stage: test.stage, missing: test.missing, failed: test.failed }));
const fail = !vm.sanitized?.parse || !vm.token_match || !vm.export_match || (test && !test.ok) || rep.verdict === "FAIL";
const verdict = fail ? "FAIL" : rep.net_comment_count > 0 ? "REVIEW" : "PASS";
const report = { verdict, reasons, input: basename(src), output: sanitized,
  structure: { parse: !!vm.sanitized?.parse, token_match: !!vm.token_match, export_match: !!vm.export_match, lines_in: rep.lines_in, lines_out: rep.lines_out, parser_sanitize: "acorn", parser_verify: vm.parser || "meriyah" },
  comments: { total: rep.comments, masked: rep.masked, kept_marked: rep.kept_marked, directive_kept: rep.directive_kept, hashbang_kept: rep.hashbang_kept },
  residue: { comment_side: rep.net_comment, code_side_note_only: rep.net_code },
  gate_test: test };
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 1));
const mark = verdict === "PASS" ? "✅" : verdict === "REVIEW" ? "⚠" : "🔴";
console.log(`${mark} RESULT: ${verdict}`);
for (const r of reasons) console.log("   - " + r);
console.log(`   structure: parse ${report.structure.parse} / tokens ${report.structure.token_match} / exports ${report.structure.export_match} / lines ${rep.lines_in}->${rep.lines_out}`);
console.log(`   comments: masked ${rep.masked} / kept(marked) ${rep.kept_marked} / directives kept ${rep.directive_kept} / residue(comment) ${rep.net_comment_count} / residue(code, note only) ${rep.net_code_count}`);
if (test) console.log(`   gate test: ${test.ok ? "PASS" : "FAIL"} (${test.registered ?? "-"}/${test.expected ?? "-"})`);
process.exit(verdict === "PASS" ? 0 : verdict === "REVIEW" ? 3 : 1);
