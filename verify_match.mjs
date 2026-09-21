// verify_match.mjs — 原本一致の器（T36）。伏せる側（sanitize.py＝手書き／sanitize_v2.mjs＝acorn）とは**別のパーサ（meriyah）**で、
// コメントを除いたトークン列を比べる。node verify_match.mjs <original.mjs> <sanitized.mjs>
// 出力（JSON 1 行）: parse の可否・トークン数・トークン列の sha256・一致／不一致・export と関数名の集合
// 🔴 伏せる側と同じパーサを使わない（同じバグを両側で共有すると一致してしまう＝自己比較）。
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "meriyah";

function strip(src) { return src.startsWith("#!") ? "//" + src.slice(2) : src; }
function tokens(src) {
  const out = []; let comments = 0;
  try {
    parse(strip(src), { module: true, next: true, onToken: (t, s, e) => out.push(t + ":" + src.slice(s, e)), onComment: () => comments++ });
  } catch (e) { return { ok: false, error: String(e.message).split("\n")[0], tokens: [], comments }; }
  return { ok: true, tokens: out, comments };
}
function names(src) {
  const exp = new Set(), fn = new Set();
  try {
    const ast = parse(strip(src), { module: true, next: true });
    for (const n of ast.body) {
      if (n.type === "FunctionDeclaration") fn.add(n.id.name);
      if (n.type === "ExportNamedDeclaration" && n.declaration) {
        const d = n.declaration;
        if (d.type === "FunctionDeclaration") { exp.add(d.id.name); fn.add(d.id.name); }
        else if (d.type === "VariableDeclaration") for (const v of d.declarations) exp.add(v.id.name);
      }
    }
  } catch (e) { return { ok: false, error: String(e.message).split("\n")[0], exports: [], functions: [] }; }
  return { ok: true, exports: [...exp].sort(), functions: [...fn].sort() };
}
const [a, b] = process.argv.slice(2);
const A = readFileSync(a, "utf8"), B = readFileSync(b, "utf8");
const ta = tokens(A), tb = tokens(B);
const sha = (arr) => createHash("sha256").update(arr.join("\n")).digest("hex");
const na = names(A), nb = names(B);
const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const r = {
  parser: "meriyah",
  original: { parse: ta.ok, error: ta.error || null, tokens: ta.tokens.length, comments: ta.comments, sha: sha(ta.tokens), exports: na.exports, functions: na.functions },
  sanitized: { parse: tb.ok, error: tb.error || nb.error || null, tokens: tb.tokens.length, comments: tb.comments, sha: sha(tb.tokens), exports: nb.exports, functions: nb.functions },
  token_match: ta.ok && tb.ok && sha(ta.tokens) === sha(tb.tokens),
  export_match: eq(na.exports, nb.exports),
  function_match: eq(na.functions, nb.functions),
  missing_exports: na.exports.filter(x => !nb.exports.includes(x)),
};
console.log(JSON.stringify(r));
