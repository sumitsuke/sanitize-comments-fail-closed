# sanitize-comments-fail-closed

**Mask every comment in a JavaScript file by default (fail-closed), keep only the lines you explicitly mark, verify the code with an *independent* parser, and gate the result with a real `import` — then say PASS / REVIEW / FAIL.**
Reproduction kit for the Sumitsuke Lab article (2026-09-21): one synthetic 67-line module with 6 poison patterns, five masking strategies, three gates.

Article: [コメントを既定で伏せたら、次に壊れたのは分割器だった](https://sumitsuke.jp/lab/sanitize-comments-fail-closed-original-match/) (Lab, Japanese).

## In one paragraph

Deleting the *lines* that contain internal words keeps the syntax valid and silently drops 2 of 4 test registrations and 4 exports. Masking only the comment lines that match a word list leaks 6 unmarked comments. Masking everything by default with a hand-written comment splitter breaks on a regex literal (`/\/\//`) — the output no longer parses. The v2 masker takes comment ranges from a parser (acorn), keeps line counts, treats multi-line comments **line by line**, keeps tool directives (`webpackIgnore`, `@__PURE__`, `@ts-ignore`, `sourceMappingURL`, …) but counts them, and the result is verified with a *different* parser (meriyah) plus a real import test. One residual internal word in a kept directive line makes the verdict **REVIEW** (exit 3), not PASS.

## Quick start

Requires Node 24 and Python 3.10+.

```bash
npm ci                                                        # acorn 8.15.0 / meriyah 6.0.6 (pinned)
node sanitize_and_check.mjs fixture.mjs out/v2 --test test.mjs   # one command → out/v2/report.json, exit 0=PASS 3=REVIEW 1=FAIL
python run.py                                                 # all five strategies → results.csv, results_summary.md, out/ (results/ = the 2026-09-21 snapshot)
```

Use it on your own file: `node sanitize_and_check.mjs your.mjs out/ --test your_test.mjs`. Mark a comment line you want to keep with `客先向け:` or `public:` at its start (per line, also inside multi-line comments).

## Files

| File | What |
|---|---|
| `fixture.mjs` | Synthetic input (67 lines, 34 comment lines, 6 poison patterns). No real project code. |
| `sanitize_v2.mjs` | The masker (acorn `onComment`; keeps line count; per-line marks; directives kept and counted; shebang kept). |
| `verify_match.mjs` | Independent verifier (meriyah): comment-free token stream sha256, export/function sets. |
| `test.mjs` | The runtime gate: imports the masked module and counts registered tests. |
| `sanitize_and_check.mjs` | One command: mask → verify → test → `report.json` with `verdict` and `reasons`. |
| `sanitize.py` | The three legacy strategies for comparison (delete lines / word-list / hand-written splitter). |
| `run.py` | Runs all five strategies and writes the table. |
| `results/` | The table and every strategy's output + report, as measured on 2026-09-21. |

## What the table says (results/results_summary.md)

| strategy | node --check | token match (meriyah) | export set | residue (comment side) | gate test |
|---|---|---|---|---|---|
| delete lines | PASS | mismatch | 4 missing | 0 | FAIL (2/4 registered) |
| word-list only | PASS | match | match | 6 | PASS |
| default-mask, hand-written splitter | **FAIL** | cannot parse | — | 6 | FAIL (import) |
| same + keep directives | **FAIL** | cannot parse | — | 7 | FAIL (import) |
| v2 (acorn) | PASS | match | match | **1** | PASS → verdict **REVIEW** |

## Limitations

Comments only: identifiers and string literals are never touched (internal words there are reported as notes, not blocked). The directive list is an example, not exhaustive. The gate test is Node's `import`; bundler behaviour (what webpack does when a magic comment is lost) is not measured. Deterministic process — one run per strategy.

## License

Code: MIT (`LICENSE`). Data and results: CC BY 4.0 (`DATA_LICENSE`).
