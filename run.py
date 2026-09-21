#!/usr/bin/env python3
"""run.py — T36 の実測を通しで回す。python run.py
4 方式 × 7 指標（(a) 行・伏せた・残した (b) node --check (c) export／関数名の集合 (d) 原本一致＝別トークナイザ
(e) 最後の網 (f) ツール指示コメント (g) 独立の門＝test.mjs）を results.csv と results_summary.md に。"""
import csv, hashlib, io, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
MODES = ["delete", "allowlist", "default", "default+directive"]
SRC = "fixture.mjs"


def sh(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


rows = []
orig_check = sh(["node", "--check", SRC])[0]
orig_test = json.loads(sh(["node", "test.mjs", SRC])[1])
for m in MODES + ["v2-acorn"]:
    out = os.path.join("out", m)
    verdict = ""
    if m == "v2-acorn":
        rc, so, se = sh(["node", "sanitize_and_check.mjs", SRC, out, "--test", "test.mjs"])
        verdict = json.load(io.open(os.path.join(out, "report.json"), encoding="utf-8"))["verdict"]
        rc, so, se = sh(["node", "sanitize_v2.mjs", SRC, out])   # 表の列は伏せる側の report.json から（1 コマンドの判定は別列）
    else:
        rc, so, se = sh([sys.executable, "sanitize.py", SRC, out, "--mode", m])
    rep = json.load(io.open(os.path.join(out, "report.json"), encoding="utf-8"))
    for k in ("comment_lines", "kept_unmarked", "deleted_lines", "spanning_block_lines", "directive_masked", "directive_kept", "kept_marked", "masked"):
        rep.setdefault(k, rep.get("comments", 0) if k == "comment_lines" else 0)
    dst = os.path.join(out, SRC)
    chk = sh(["node", "--check", dst])
    vm = json.loads(sh(["node", "verify_match.mjs", SRC, dst])[1])
    trc, tso, tse = sh(["node", "test.mjs", dst])
    try:
        t = json.loads(tso)
    except Exception:
        t = {"ok": False, "stage": "crash", "error": (tso or tse)[:120]}
    rows.append({
        "mode": m,
        "lines_in": rep["lines_in"], "lines_out": rep["lines_out"], "comment_lines": rep["comment_lines"],
        "masked": rep["masked"], "kept_marked": rep["kept_marked"], "kept_unmarked": rep["kept_unmarked"],
        "deleted_lines": rep["deleted_lines"], "spanning_block_lines": rep["spanning_block_lines"],
        "node_check": "PASS" if chk[0] == 0 else "FAIL",
        "node_check_msg": (chk[2].splitlines()[-4] if chk[0] != 0 and chk[2] else "").strip()[:80],
        "token_match": vm["token_match"], "parse_sanitized": vm["sanitized"]["parse"],
        "parse_error": (vm["sanitized"]["error"] or "")[:60],
        "export_match": vm["export_match"], "function_match": vm["function_match"],
        "missing_exports": ";".join(vm["missing_exports"]),
        "net_comment": rep["net_comment_count"], "net_code": rep["net_code_count"],
        "directive_masked": rep["directive_masked"], "directive_kept": rep["directive_kept"],
        "test": "PASS" if t.get("ok") else "FAIL",
        "test_registered": t.get("registered", ""), "test_missing": ";".join(t.get("missing", [])),
        "test_stage": t.get("stage", ""), "sha256_out": sha(dst), "one_command_verdict": verdict,
    })

with io.open("results.csv", "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

L = []
L.append(f"# T36 results（{SRC} sha256 {sha(SRC)[:12]}・acorn {json.load(open('node_modules/acorn/package.json'))['version']}・node {sh(['node','--version'])[1]}）\n")
L.append(f"原本: node --check exit {orig_check}・test {'PASS' if orig_test['ok'] else 'FAIL'}（登録 {orig_test['registered']}/{orig_test['expected']}）\n")
L.append("| 方式 | 行 in→out | コメント行 | 伏せた | 残した(印) | 残した(印なし) | 消した行 | またぐ | node --check | 原本一致(token) | export 集合 | 最後の網 cmt/code | 指示 伏せ/残し | 独立の門 test | 1 コマンドの判定 |")
L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for r in rows:
    L.append(f"| {r['mode']} | {r['lines_in']}→{r['lines_out']} | {r['comment_lines']} | {r['masked']} | {r['kept_marked']} | {r['kept_unmarked']} | {r['deleted_lines']} | {r['spanning_block_lines']} | {r['node_check']} | {'一致' if r['token_match'] else '不一致'}{'' if r['parse_sanitized'] else '（parse 不可）'} | {'一致' if r['export_match'] else '不一致 '+r['missing_exports']} | {r['net_comment']}/{r['net_code']} | {r['directive_masked']}/{r['directive_kept']} | {r['test']}{(' 登録 '+str(r['test_registered'])+'/4') if r['test_registered']!='' else ' '+r['test_stage']} | {r['one_command_verdict'] or '—'} |")
L.append("")
L.append("読み方: 「原本一致」は伏せる側（sanitize.py＝手書き分割器／sanitize_v2.mjs＝acorn）と別のパーサ **meriyah** でコメントを除いたトークン列の sha256 を比べたもの。v2-acorn の「コメント行」欄はコメントの個数（区間）。「独立の門」は伏せた後のモジュールを import して 4 テストを登録・実行したもの。")
io.open("results_summary.md", "w", encoding="utf-8", newline=chr(10)).write("\n".join(L) + "\n")
print("\n".join(L))
