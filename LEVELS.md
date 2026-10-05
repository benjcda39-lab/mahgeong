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
