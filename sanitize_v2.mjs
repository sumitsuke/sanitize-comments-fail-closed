// sanitize_v2.mjs — 伏せる側 v2（T36）。コメント区間を手書きの分割器でなくパーサ（acorn の onComment）で取る。
// node sanitize_v2.mjs <in.mjs> <out_dir>   → <out_dir>/<name>・<out_dir>/report.json。終了コード 0=PASS／3=REVIEW／1=FAIL
// 規則:
//   ・コメントは既定で伏せる。印（`客先向け:` / `public:`）で始まる**行**だけ、印を外して残す（複数行コメントは行ごとに判定＝先頭行の印は後続行に効かない）
//   ・ツール指示コメント（webpackIgnore・@__PURE__・@ts-*・sourceMappingURL・eslint・prettier・istanbul/c8）を含む行は残して数える（人が見る）
//   ・shebang（#!）は残す／行数は変えない（この方式の要件＝行位置を保つ）／コードは 1 バイトも触らない（区間の外は写すだけ）
//   ・最後の網＝伏せた後の中身に社内語・日付が残っていれば数える。コメント側に 1 件でも残れば **REVIEW**（人が裁定するまで納品しない）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import * as acorn from "acorn";

const MARKS = ["客先向け:", "public:"];
// 社内語の一覧（汎用語に絞る＝この一覧自体も公開される。案件・組織に固有の語は書かない）
const WORDS = ["外部監査", "監査", "運用者", "客先", "社内", "内部", "台帳", "実害", "レポート", "納品", "お客様", "相手", "発注", "検品", "要項", "暫定", "TODO", "FIXME", "未公開", "非公開"];
const MASK = "（注記を省略）";   // 伏せ字自体が社内語の一覧に当たらない語で
const DIRECTIVE = /webpackIgnore|webpackChunkName|@__PURE__|__PURE__|@ts-ignore|@ts-expect-error|@ts-nocheck|sourceMappingURL|eslint-disable|eslint-enable|prettier-ignore|istanbul ignore|c8 ignore/;
const DATE = /20\d\d-\d\d-\d\d/;

const [src, outDir] = process.argv.slice(2);
const text = readFileSync(src, "utf8");
const comments = [];
acorn.parse(text, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true, onComment: comments });
const countLines = (t) => t.split(/\r?\n/).length - (t.endsWith("\n") ? 1 : 0);
const stats = { lines_in: countLines(text), comments: comments.length,
  masked: 0, kept_marked: 0, directive_kept: 0, hashbang_kept: 0, multiline_blocks: 0, net_comment: [], net_code: [] };

function oneLine(body) {
  // 1 行ぶんのコメント本文の扱い＝印なら残す（印を外す）／指示なら残す／それ以外は伏せる
  const s = body.trim();
  for (const mk of MARKS) if (s.startsWith(mk)) { stats.kept_marked++; return s.slice(mk.length).trim(); }
  if (DIRECTIVE.test(s)) { stats.directive_kept++; return s; }
  stats.masked++; return MASK;
}
function replaceBody(c) {
  const body = c.value;
  if (c.start === 0 && text.startsWith("#!")) { stats.hashbang_kept = 1; return "#!" + body; }
  if (c.type === "Line") return "//" + " " + oneLine(body);
  const lines = body.split("\n");
  if (lines.length === 1) return "/* " + oneLine(body) + " */";
  stats.multiline_blocks++;
  // 複数行: 行数を保ち、各行を個別に判定する。先頭行（/* の直後）も末尾行（*/ の直前）も同じ規則
  const out = lines.map((ln, i) => {
    const t = ln.replace(/^[ \t]*\*?[ \t]*/, "");
    if (t === "" && (i === 0 || i === lines.length - 1)) return ln.replace(/[^\s]/g, "");   // 空の先頭・末尾行はそのまま（字下げだけ）
    if (t === "") return " *";
    return (i === 0 ? " " : " * ") + oneLine(t);   // 先頭行は /* の直後＝* を付けない
  });
  return "/*" + out.join("\n") + "*/";
}
let out = ""; let pos = 0;
for (const c of comments) { out += text.slice(pos, c.start) + replaceBody(c); pos = c.end; }
out += text.slice(pos);

// 最後の網＝伏せた後の中身。コメント側は acorn で再取得、コード側は区間の外
const after = [];
let parseError = null;
try { acorn.parse(out, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true, onComment: after }); }
catch (e) { parseError = String(e.message); }
const lineOf = (i) => out.slice(0, i).split("\n").length;
for (const c of after) {
  const hits = WORDS.filter(w => c.value.includes(w)); if (DATE.test(c.value)) hits.push("date");
  if (hits.length) stats.net_comment.push({ line: lineOf(c.start), hits: hits.slice(0, 4), text: c.value.trim().slice(0, 80) });
}
let codeOnly = ""; let p2 = 0;
for (const c of after) { codeOnly += out.slice(p2, c.start) + " ".repeat(c.end - c.start); p2 = c.end; }
codeOnly += out.slice(p2);
codeOnly.split("\n").forEach((ln, i) => { const hits = WORDS.filter(w => ln.includes(w)); if (DATE.test(ln)) hits.push("date"); if (hits.length) stats.net_code.push({ line: i + 1, hits: hits.slice(0, 4), text: ln.trim().slice(0, 80) }); });
stats.lines_out = countLines(out);
stats.net_comment_count = stats.net_comment.length; stats.net_code_count = stats.net_code.length;
stats.mode = "v2-acorn"; stats.src = basename(src);
// 判定（伏せる側だけで決められる分）: FAIL＝出力が parse できない／行数が変わった。REVIEW＝コメント側に社内語が残った。PASS＝それ以外
stats.verdict = parseError || stats.lines_out !== stats.lines_in ? "FAIL" : stats.net_comment_count > 0 ? "REVIEW" : "PASS";
stats.reasons = [];
if (parseError) stats.reasons.push("output does not parse: " + parseError);
if (stats.lines_out !== stats.lines_in) stats.reasons.push(`line count changed ${stats.lines_in} -> ${stats.lines_out}`);
if (stats.net_comment_count) stats.reasons.push(`comment residue: ${stats.net_comment_count} (human decision required)`);
if (stats.directive_kept) stats.reasons.push(`directives kept: ${stats.directive_kept} (listed for review)`);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, basename(src)), out);
writeFileSync(join(outDir, "report.json"), JSON.stringify(stats, null, 1));
const { net_comment, net_code, ...brief } = stats;
console.log(JSON.stringify(brief));
process.exit(stats.verdict === "PASS" ? 0 : stats.verdict === "REVIEW" ? 3 : 1);
