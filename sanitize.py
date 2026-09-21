#!/usr/bin/env python3
"""sanitize.py — 納品する .js/.mjs のコメントを伏せる（4 方式を比べるための器・T36）。

  python sanitize.py <in.mjs> <out_dir> --mode delete|allowlist|default|default+directive

方式:
  delete            社内語を含む「行」を消す（2026-08-26 の実害の型。比較用の毒版）
  allowlist         社内語（20 語）に当たったコメント行だけ伏せる（旧・fail-open。記述から復元）
  default           コメントは既定で伏せ、印（`客先向け:` / `public:`）の付いた行だけ残す（現行・fail-closed）
  default+directive default ＋ ツール指示コメント（webpackIgnore・@__PURE__・@ts-*・sourceMappingURL・eslint・prettier）は
                    伏せずに残して report に数える（v2 の提案）

🔴 行数とコードは 1 バイトも変えない（差し替えるのはコメントの本文だけ）。delete だけは行を消す（毒版）。
🔴 行をまたぐブロックコメント（開き・途中・閉じ）は触らない＝最後の網が中身を見る。
出力: <out_dir>/<basename>（伏せた本文）と <out_dir>/report.json（数えたもの）。
"""
import io, json, os, re, sys

MARKS = ("客先向け:", "public:")
WORDS = ("外部監査", "監査", "運用者", "客先", "社内", "内部", "台帳", "実害", "レポート", "納品",
         "お客様", "相手", "発注", "検品", "要項", "暫定", "TODO", "FIXME", "未公開", "非公開")   # 汎用語に絞る（一覧も公開される）
MASK = "（注記を省略）"
DATE = re.compile(r"20\d\d-\d\d-\d\d")
DIRECTIVE = re.compile(r"webpackIgnore|webpackChunkName|@__PURE__|__PURE__|@ts-ignore|@ts-expect-error|@ts-nocheck|"
                       r"sourceMappingURL|eslint-disable|eslint-enable|prettier-ignore|istanbul ignore|c8 ignore")


def line_comment_pos(line):
    """引用符の外にある // の位置（現行の器と同じ判定＝正規表現リテラルは見ない）。"""
    q = None; i = 0
    while i < len(line):
        c = line[i]
        if q:
            if c == "\\": i += 2; continue
            if c == q: q = None
        elif c in ("'", '"', "`"): q = c
        elif c == "/" and i + 1 < len(line) and line[i + 1] == "/": return i
        i += 1
    return None


def inline_block_pos(line):
    """引用符の外にあり同じ行で閉じる /* … */ の (開き, 閉じ)。"""
    q = None; start = None; i = 0
    while i < len(line):
        c = line[i]
        if start is not None:
            if c == "*" and i + 1 < len(line) and line[i + 1] == "/": return (start, i)
        elif q:
            if c == "\\": i += 2; continue
            if c == q: q = None
        elif c in ("'", '"', "`"): q = c
        elif c == "/" and i + 1 < len(line) and line[i + 1] == "*":
            start = i; i += 2; continue
        i += 1
    return None


def split_line(raw):
    """(コメントの側, コードの側)。"""
    m = raw.strip()
    if m.startswith("//") or (m.startswith("/*") and m.endswith("*/")) or m.startswith("*"):
        return (raw, "")
    i = line_comment_pos(raw); jb = inline_block_pos(raw)
    if jb is not None and (i is None or jb[0] < i):
        a, z = jb
        return (raw[a:z + 2], raw[:a] + raw[z + 2:])
    if i is not None:
        return (raw[i:], raw[:i])
    return ("", raw)


def body_out(body, mode, stats):
    s = body.strip()
    for mk in MARKS:
        if s.startswith(mk):
            stats["kept_marked"] += 1
            return s[len(mk):].strip()
    if mode == "default+directive" and DIRECTIVE.search(s):
        stats["directive_kept"] += 1
        return s
    if mode == "allowlist":
        if any(w in s for w in WORDS):
            stats["masked"] += 1
            return MASK
        stats["kept_unmarked"] += 1
        return s
    if DIRECTIVE.search(s):
        stats["directive_masked"] += 1
    stats["masked"] += 1
    return MASK


def sanitize(text, mode):
    stats = dict(lines_in=0, lines_out=0, comment_lines=0, masked=0, kept_marked=0, kept_unmarked=0,
                 directive_kept=0, directive_masked=0, spanning_block_lines=0, deleted_lines=0,
                 net_comment=[], net_code=[])
    out = []
    for no, ln in enumerate(text.splitlines(), 1):
        stats["lines_in"] += 1
        raw = ln[:-1] if ln.endswith("\r") else ln
        m = raw.strip(); head = raw[:len(raw) - len(raw.lstrip())]
        cmt, _code = split_line(raw)
        if cmt: stats["comment_lines"] += 1
        if mode == "delete":
            if cmt and any(w in cmt for w in WORDS):
                stats["deleted_lines"] += 1
                continue
            out.append(raw); continue
        if m.startswith("//"):
            raw = head + "// " + body_out(m[2:], mode, stats)
        elif m.startswith("/*") and m.endswith("*/") and len(m) >= 4:
            raw = head + "/* " + body_out(m[2:-2], mode, stats) + " */"
        elif m.startswith("/*") or m.endswith("*/") or m.startswith("*"):
            stats["spanning_block_lines"] += 1
        else:
            i = line_comment_pos(raw); jb = inline_block_pos(raw)
            if jb is not None and (i is None or jb[0] < i):
                a, z = jb
                raw = raw[:a] + "/* " + body_out(raw[a + 2:z], mode, stats) + " */" + raw[z + 2:]
            elif i is not None:
                raw = raw[:i] + "// " + body_out(raw[i + 2:], mode, stats)
        out.append(raw)
    stats["lines_out"] = len(out)
    # 最後の網＝伏せた後の中身に社内語・日付が残っていないか（コメントの側＝赤／コードの側＝⚠）
    for no, raw in enumerate(out, 1):
        cmt, code = split_line(raw)
        for where, s in (("comment", cmt), ("code", code)):
            hits = [w for w in WORDS if w in s]
            if DATE.search(s): hits.append("date")
            if hits:
                (stats["net_comment"] if where == "comment" else stats["net_code"]).append(
                    {"line": no, "hits": hits[:4], "text": raw.strip()[:80]})
    return "\n".join(out) + ("\n" if text.endswith("\n") else ""), stats


def main():
    if len(sys.argv) < 5 or sys.argv[3] != "--mode":
        print(__doc__); sys.exit(2)
    src, out_dir, mode = sys.argv[1], sys.argv[2], sys.argv[4]
    text = io.open(src, encoding="utf-8", newline="").read()
    crlf = "\r\n" in text
    text = text.replace("\r\n", "\n")
    out, stats = sanitize(text, mode)
    if crlf: out = out.replace("\n", "\r\n")
    os.makedirs(out_dir, exist_ok=True)
    dst = os.path.join(out_dir, os.path.basename(src))
    io.open(dst, "w", encoding="utf-8", newline="").write(out)
    stats["mode"] = mode; stats["src"] = os.path.basename(src)
    stats["net_comment_count"] = len(stats["net_comment"]); stats["net_code_count"] = len(stats["net_code"])
    io.open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8").write(json.dumps(stats, ensure_ascii=False, indent=1))
    print(json.dumps({k: v for k, v in stats.items() if not isinstance(v, list)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
