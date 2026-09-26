// Shared scoreboards. The server keeps its DB credentials private; browsers only send
// a local anonymous player ID and self-reported finish data. This is not anti-cheat.
export function boardKey(board, rules) {
  if (!board || typeof board !== "object") return null;
  if (board.kind === "daily") {
    if (!Number.isSafeInteger(board.n) || board.n < 1 || board.n > 100000) return null;
    return `daily:${board.n}`; // one table for each day's identical board
  }
  if (board.kind !== "practice") return null;
  const { deck, region, mode, size, deal } = board;
  if (!Object.hasOwn(rules.decks, deck) || ![12, 18, 24, 30].includes(size) || !["fair", "classic"].includes(deal)) return null;
  const d = rules.decks[deck];
  if (deck === "world" ? !["all", "africa", "americas", "asia", "europe", "oceania"].includes(region) : region !== "all") return null;
  if (![...d.kinds, "mix"].includes(mode) || rules.capacity(d.pool(region), mode) < size) return null;
  return `practice:${deck}:${region}:${mode}:${size}:${deal}`;
}

export function validSubmission(data, rules) {
  if (!data || typeof data !== "object" || !boardKey(data.board, rules)) return false;
  if (typeof data.playerId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.playerId)) return false;
  if (typeof data.name !== "string" || data.name.trim().length < 1 || data.name.trim().length > 24 || /[\x00-\x1f\x7f]/.test(data.name)) return false;
  return [[data.milliseconds, 1, 86400000], [data.mistakes, 0, 1000], [data.hints, 0, 1000], [data.shuffles, 0, 1000]]
    .every(([v, lo, hi]) => Number.isSafeInteger(v) && v >= lo && v <= hi);
}

export const schema = `CREATE TABLE IF NOT EXISTS mahgeong_scores (
  board_key text NOT NULL,
  player_id uuid NOT NULL,
  name varchar(24) NOT NULL,
  milliseconds integer NOT NULL CHECK (milliseconds BETWEEN 1 AND 86400000),
  mistakes integer NOT NULL CHECK (mistakes BETWEEN 0 AND 1000),
  hints integer NOT NULL CHECK (hints BETWEEN 0 AND 1000),
  shuffles integer NOT NULL CHECK (shuffles BETWEEN 0 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_key, player_id)
)`;

export async function submitScore(db, data, rules) {
  const key = boardKey(data.board, rules);
  // A player keeps their best result on this table. Concurrent submissions cannot
  // replace a faster score with a slower one.
  await db.query(`INSERT INTO mahgeong_scores (board_key, player_id, name, milliseconds, mistakes, hints, shuffles)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (board_key, player_id) DO UPDATE SET
      name = EXCLUDED.name, milliseconds = EXCLUDED.milliseconds, mistakes = EXCLUDED.mistakes,
      hints = EXCLUDED.hints, shuffles = EXCLUDED.shuffles, updated_at = now()
    WHERE (EXCLUDED.milliseconds, EXCLUDED.mistakes) < (mahgeong_scores.milliseconds, mahgeong_scores.mistakes)`,
  [key, data.playerId, data.name.trim(), data.milliseconds, data.mistakes, data.hints, data.shuffles]);
  return getScores(db, key, data.playerId);
}

export async function getScores(db, key, playerId = null) {
  const [top, mine] = await Promise.all([
    db.query(`SELECT name, milliseconds, mistakes, hints, shuffles, player_id = $2::uuid AS you
      FROM mahgeong_scores WHERE board_key = $1
      ORDER BY milliseconds ASC, mistakes ASC, updated_at ASC, player_id ASC LIMIT 10`, [key, playerId]),
    playerId ? db.query(`SELECT 1 + (SELECT count(*) FROM mahgeong_scores other WHERE other.board_key = me.board_key
      AND (other.milliseconds, other.mistakes, other.updated_at, other.player_id)
        < (me.milliseconds, me.mistakes, me.updated_at, me.player_id)) AS rank,
      milliseconds, mistakes FROM mahgeong_scores me WHERE board_key = $1 AND player_id = $2::uuid`, [key, playerId]) : Promise.resolve({ rows: [] }),
  ]);
  return { scores: top.rows.map(({ name, milliseconds, mistakes, hints, shuffles, you }) => ({ name, milliseconds, mistakes, hints, shuffles, you })),
    mine: mine.rows[0] ? { ...mine.rows[0], rank: Number(mine.rows[0].rank) } : null };
}

// A season's snapshot can be copied at any time, BEFORE the free database expires.
// On a replacement database, the operator increments SEASON_NUMBER explicitly.
export function seasonNumber() {
  const n = Number(process.env.SEASON_NUMBER || 1);
  if (!Number.isSafeInteger(n) || n < 1 || n > 10000) throw new Error("Invalid SEASON_NUMBER");
  return n;
}
export async function seasonSummary(db, season) {
  const [started, counts, champions] = await Promise.all([
    db.query("SELECT MIN(updated_at) AS first_score_at FROM mahgeong_scores"),
    db.query("SELECT count(DISTINCT board_key) AS boards, count(DISTINCT player_id) AS players FROM mahgeong_scores"),
    db.query(`WITH winners AS (
      SELECT DISTINCT ON (board_key) board_key, player_id, name, milliseconds, mistakes
      FROM mahgeong_scores
      ORDER BY board_key, milliseconds, mistakes, updated_at, player_id
    ) SELECT player_id::text AS id, name, count(*) AS wins, min(milliseconds) AS best_ms
      FROM winners GROUP BY player_id, name
      ORDER BY wins DESC, best_ms ASC, name ASC LIMIT 10`),
  ]);
  return { season, firstScoreAt: started.rows[0]?.first_score_at || null,
    boards: Number(counts.rows[0]?.boards || 0), players: Number(counts.rows[0]?.players || 0),
    champions: champions.rows.map(({ name, wins, best_ms }) => ({ name, wins: Number(wins), bestMs: Number(best_ms) })) };
}
