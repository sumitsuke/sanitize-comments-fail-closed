#!/usr/bin/env node
// 監査へ回した版（2026-09-01）。運用者のメモ: 台帳 H-12 を見よ。暫定 09-07。
// 客先向け: 金額の文字列と品目の一覧を集計する小さなモジュール（配布用）。
/**
 * JSDoc: 監査 A-3 の指摘で書き直した。運用者の要項 #12。
 * 客先向け: parseAmount は「100円」「1,200円」を整数にする。
 */
import { readFileSync } from "node:fs";

/* 客先向け: 公開の接続先。ここは変更不要
 * INTERNAL-42 は公開しない（毒(vi): 先頭行の印は後続行に効かない。この語は一覧に無い）
 */
export const ENDPOINT = "https://example.com/api//items"; // 客先向け: 文字列の中の // は URL の一部
export const DOC_URL = "https://example.com/docs#監査"; // 運用者: 監査の記録は台帳へ

// 毒(ii): 正規表現リテラルの中の // はコメントではない（内部: 触らない）
export const DOUBLE_SLASH = /\/\//;
export const AMOUNT_RE = /^(\d{1,3}(?:,\d{3})*|\d+)円$/; // 客先向け: 金額の形

// 毒(iii): テンプレートリテラルの中の /* */ はコメントではない
export const TEMPLATE_ONE = `/* not a comment */ ${ENDPOINT}`; // 運用者: 実害 2 件目の型
export const TEMPLATE_MULTI = `line1
/* 監査 ここもコードの側 */ line2
*/ line3`;

// 毒(iv): 行コメントの中に */ が来る。運用者の注記 */ ここまでコメント
export function parseAmount(text) {
  const m = AMOUNT_RE.exec(String(text).trim()); // 台帳 H-12: 全角は受けない（裁定）
  if (!m) return null; /* 客先向け: 形が違えば null */
  return Number(m[1].replace(/,/g, "")); // 監査 A-3: parseInt を使わない
}

/**
 * 合計。運用者のメモ: 発注 3 回目で仕様が変わった。
 * 客先向け: null は無視して足す。
 */
export function sum(items) {
  let total = 0;
  for (const it of items) {
    const v = parseAmount(it); // 客先向け: 1 件ずつ
    if (v !== null) total += v; // 監査で指摘された分岐
  }
  return total;
}

// 毒(v): ツール指示コメント。伏せると build の挙動が変わる
export async function loadPlugin(path) {
  const mod = await import(/* webpackIgnore: true */ path); // 運用者: 動的 import は bundler に触らせない
  return mod;
}
export const PURE_VALUE = /*@__PURE__*/ computeOnce(); // 内部: tree-shaking の印
// @ts-ignore 監査: 型は後で直す
export const untyped = readFileSync.length;

function computeOnce() {
  return 42; // 台帳 H-13: 定数
}

// 監査の型（2026-08-26）: テストの登録行に社内語が入っていると、行ごと消す無害化で登録が消える
export function registerTests(rec) {
  rec("parse_amount_basic", () => parseAmount("100円") === 100);
  rec("parse_amount_comma", () => parseAmount("1,200円") === 1200); // 運用者: 客先の実データの形
  rec("sum_ignores_null", () => sum(["100円", "x", "200円"]) === 300); // 監査 A-3
  rec("template_is_code", () => TEMPLATE_ONE.startsWith("/* not"));
}

//# sourceMappingURL=fixture.mjs.map
