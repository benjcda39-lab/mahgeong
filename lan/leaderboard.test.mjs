import { test } from "node:test";
import assert from "node:assert/strict";
import { boardKey, validSubmission, submitScore, getScores, schema } from "./leaderboard.mjs";
const rules = { decks: {
  world: { kinds: ["capital", "flag", "currency", "population", "leader"], pool: region => region === "oceania" ? Array(14) : Array(197) },
  states: { kinds: ["capital", "flag"], pool: () => Array(50) },
  presidents: { kinds: ["years", "number"], pool: () => Array(45) },
}, capacity: (pool, mode) => mode === "currency" && pool.length === 14 ? 5 : pool.length };
const board = { kind: "practice", deck: "world", region: "all", mode: "flag", size: 12, deal: "fair" };
const data = { board, playerId: "809b5685-e41b-4ba9-9dea-44630b88f90b", name: "Ben", milliseconds: 7012, mistakes: 0, hints: 0, shuffles: 0 };
test("separate practice tables by deal, region, mode, size and deck; reject invalid combinations", () => {
  const key = boardKey(board, rules);
  for (const field of ["deal", "region", "mode", "size", "deck"]) {
    const changed = { ...board, [field]: { deal: "classic", region: "europe", mode: "capital", size: 18, deck: "states" }[field] };
    if (field === "deck") changed.region = "all";
    assert.notEqual(boardKey(changed, rules), key);
  }
  assert.equal(boardKey({ ...board, deck: "states", region: "europe" }, rules), null);
  assert.equal(boardKey({ ...board, region: "oceania", mode: "currency" }, rules), null);
  assert.equal(boardKey({ kind: "daily", n: 12 }, rules), "daily:12");
});
test("validates precise times and named browser ID, with no HTML in returned names", () => {
  assert.equal(validSubmission(data, rules), true);
  assert.equal(validSubmission({ ...data, milliseconds: 0 }, rules), false);
  assert.equal(validSubmission({ ...data, milliseconds: 7.12 }, rules), false);
  assert.equal(validSubmission({ ...data, name: "<b>Ben</b>" }, rules), true); // UI uses textContent
  assert.equal(validSubmission({ ...data, name: "Ben\nOther" }, rules), false);
  assert.equal(validSubmission({ ...data, playerId: "not-an-id" }, rules), false);
  assert.match(schema, /milliseconds integer/);
});
test("SQL sorts millisecond times then misses, retaining one best per player", async () => {
  const calls = [];
  const db = { query: async (sql, args) => {
    calls.push({ sql, args });
    if (sql.startsWith("SELECT name")) return { rows: [{ name: "Ben", milliseconds: 7012, mistakes: 0, hints: 0, shuffles: 0, you: true }] };
    if (sql.startsWith("SELECT 1")) return { rows: [{ rank: "1", milliseconds: 7012, mistakes: 0 }] };
    return { rows: [] };
  } };
  const result = await submitScore(db, data, rules);
  assert.equal(result.scores[0].milliseconds, 7012);
  assert.match(calls[0].sql, /EXCLUDED\.milliseconds, EXCLUDED\.mistakes/);
  assert.match(calls[1].sql, /ORDER BY milliseconds ASC, mistakes ASC/);
  assert.equal(calls[0].args[3], 7012);
  assert.equal((await getScores(db, boardKey(board, rules))).scores.length, 1);
});

test("season summary counts distinct boards and players, ranks crowns", async () => {
  const { seasonSummary } = await import("./leaderboard.mjs");
  const db = { query: async sql => {
    if (sql.includes("MIN(updated_at)")) return { rows: [{ first_score_at: "2026-09-26T00:00:00.000Z" }] };
    if (sql.includes("count(DISTINCT board_key)")) return { rows: [{ boards: "3", players: "2" }] };
    assert.match(sql, /DISTINCT ON \(board_key\)/);
    assert.match(sql, /ORDER BY wins DESC, best_ms ASC/);
    return { rows: [{ name: "Ben", wins: "2", best_ms: 7001 }] };
  } };
  const summary = await seasonSummary(db, 1);
  assert.equal(summary.season, 1);
  assert.equal(summary.boards, 3);
  assert.equal(summary.players, 2);
  assert.deepEqual(summary.champions, [{ name: "Ben", wins: 2, bestMs: 7001 }]);
});
