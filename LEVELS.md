# World levels (local preview, not deployed)

60 levels, cleared sequentially. Any cleared level can be replayed. Completion unlocks
one next level; misses, hints, shuffles and untimed play do not block progress.

| Levels | Pairs / tiles | Clues | Layout |
| --- | --- | --- | --- |
| 1-4 | 3 / 6 | Flags | Two tiles per row, all free |
| 5-8 | 4 / 8 | Flags | Two tiles per row, all free |
| 9-10 | 5 / 10 | Flags | Two tiles per row, all free |
| 11-20 | 6 to 9 / 12 to 18 | Flags | Four wide, side blocking |
| 21-30 | 12 / 24 | Capitals | Existing stacked fair layout |
| 31-40 | 18 / 36 | Capitals | Existing stacked fair layout |
| 41-50 | 24 / 48 | Flags + capitals | Existing stacked fair layout |
| 51-60 | 30 / 60 | Flags + capitals + currencies + populations | Existing stacked fair layout |

## Country order

Source is the unchanged DATA table in index.html in this repository (197 World
countries with the game's existing population estimates labelled 2024). Population
is a transparent proxy for exposure, not surveyed recognition. Rank by descending
population; country name in English breaks ties. Do not claim this is an objective
measure of country familiarity. The entire ranking is reproducible in LEVEL_RANK.

An explicit 15-country teaching prelude comes first: France, Japan, Brazil,
Australia, US, UK, Canada, Germany, Italy, China, India, Mexico, Spain, South Korea,
New Zealand. These are chosen lesson examples, not an empirical ranking. The first
board contains France, Japan, Brazil. All remaining entries follow population rank.
The ordered list has exactly 197 distinct countries. Levels 1-10 introduce the
prelude progressively; levels 11-20 expand to the first 65 entries. Levels 21-40
advance a rolling pool to entry 130; levels 41-60 advance to entry 197. Pool widths
are 40 for the middle stages and 65 for later stages, with overlap for repetition.
Countries and arrangement are deterministic per level (seed n*104729+61), with a
second arrangement on portrait screens. Hints and fair shuffle allow recovery.

## Access and persistence

New storage profiles start in Levels. Daily unlocks AFTER clearing level 10.
Existing daily save keys or results preserve access and the existing Daily default.
The last selected Levels/Daily/Practice tab is remembered for later visits; 2 Player
is never auto-rejoined after a reload. Practice and 2 Player remain visible and open.
Level progress and a partial board are stored locally, versioned v1, without accounts.
Storage clearing / another device loses progress. A private or blocked-storage browser
can play, but persistence cannot be guaranteed. This is not a security gate.

Levels use kind=level, not kind=practice or kind=daily. Separate best-time storage.
No daily results, streaks or leaderboard submissions. Server validation unchanged.
Existing daily seeded dealing, DATA, modes and original layouts unchanged. Small
layouts are added under new keys 3-10. Timed toggle, contrast, Practice death match,
expanded decks and multiplayer remain intact.

## Review / approval

Both local worktrees contain the change and regenerated docs/index.html. Nothing
pushed or deployed. Review phone/desktop screenshots before approval and deployment.

## Sudden Death and Flawless medals (local preview)

The Levels panel now has Normal / Sudden Death. Sudden Death uses the same 60
boards with a separate ladder and partial-board save. One wrong pair ends that
attempt; the result button returns to the first unbanked level. Clearing 10, 20,
30, 40 or 50 banks those clears permanently. For example, failing at 14 returns
to 11, with 1-10 banked. Before the first checkpoint, return to 1. There is no
level picker in this journey. Hints are disabled; shuffle and timed/untimed play
remain available. Restart replays the current board, not the checkpoint.

Clearing 60 completes and permanently banks the journey. The final board can be
replayed without losing completion. Sudden Death never advances Normal clears or
unlocks Daily. Switching journeys and reloading preserve separate partial boards.
The last chosen journey is remembered. Existing landing-tab logic is unchanged;
the previously paused change to make everybody land on Levels is NOT included.

Flawless means zero misses, exactly as requested. Hints, shuffle and untimed play
qualify. Every freshly cleared solo board earns one medal; reopening a result or
reloading does not earn another. Daily awards are keyed by puzzle number and are
counted once, with their own profile count. Recorded old zero-miss Daily results
are backfilled, but unrecorded old Practice runs cannot be reconstructed. Normal
Levels, Sudden Death, Practice, Death match, Daily and 2 Player each have their
own medal count in the collection. In 2 Player, the shared board must be finished,
the player must have claimed at least one pair, and their personal misses must be
zero. Existing server-provided miss totals prevent reconnects erasing mistakes;
room-token medal IDs prevent repeat awards. No server changes.

The existing statistics icon now opens Your game profile. Normal progress,
Sudden Death's current level/banked clears, medal counts and the original Daily
statistics appear there. All are per-device local storage, without accounts or
sync. Clearing browser storage loses the collection and progress. Medals are
personal rewards, not verified competitive scores. No new leaderboard writes.

Regression checks cover checkpoint rollback/resume, completion, separate saves,
Normal tolerance/unlock, all medal categories, duplicate prevention and old Daily
backfill. The 120-board Daily byte signature remains
056b08dd00561a3ab8dc766d82d17004dbe806f84432154f4f895fa739ae25a4.
