# Mahgeong

A daily geography puzzle played like mahjong solitaire. Clear the board by pairing each country with its capital, flag, currency or population. One board a day, the same for everyone, then a shareable result grid and a streak. The Practice tab adds regional decks (Africa, the Americas, Asia, Europe, Oceania), US states with their capitals and flags, and US presidents with their years in office. State flags in `flags/` are public-domain renders from Wikimedia Commons.

- `index.html` is the whole game: one dependency-free file, published as a Claude artifact at https://claude.ai/code/artifact/4d8bba8c-9f88-4bac-b866-814f1c6e9d97. The artifact host wraps it in a doctype and head; `showcase/e2e/walkthrough.mjs` does the same when serving it locally.
- Puzzle No. 1 is 11 September 2026 (local time). The day number seeds the deal, so every player gets the same board. Keep the epoch and the localStorage keys stable or streaks break.

## Promo video

`showcase/` mirrors the Beerconomy pipeline: Playwright drives the real game in Chrome and records it, a script generates the music, and Remotion cuts the scenes.

```
cd showcase
npm ci
npm run music          # writes public/music/mahgeong-theme.wav
npm run walkthrough    # records desktop + phone sessions, screenshots each step, writes remotion/manifest.generated.ts
npm run render:landscape   # out/mahgeong-promo-16x9.mp4
npm run render:portrait    # out/mahgeong-promo-9x16.mp4
npm run studio         # Remotion Studio, to tweak scenes live
```

The step list and the promo copy live in `showcase/e2e/steps.mjs`. The portrait cut uses the phone-size recording; the landscape cut uses the desktop one.

## Two-player over Wi-Fi (LAN)

One device hosts, the other joins - no internet needed:

```
node lan/server.mjs        # prints http://<your-LAN-address>:8642
```

Both players open that address, tap the **2 Player** tab, and one hosts while the other joins with the four-letter room code. Both race on the same 18-pair board; every pair you clear is one your rival can't. The server deals the board, keeps score, and puts a dropped player right back where they were when they reopen the page. Offline, flag images fall back to emoji flags.

## Tests

```
cd showcase
npm ci
npm test           # unit: free-tile rules, dealing, selection and matching (jsdom)
npm run e2e        # full games start to finish in Chrome, desktop + phone
npm run e2e:versus # two-player LAN game against the real server, incl. reconnect
```

## Public site (GitHub Pages)

`index.html` has no page wrapper because the artifact host adds one. For GitHub Pages, `node build-pages.mjs` writes a wrapped copy to `docs/index.html`, and Pages serves the `docs` folder from `main`. Run the build and commit `docs/` after every change to `index.html`.

## Shared high scores (optional)

The same Node server that hosts the WebSocket rooms also serves `/api/scores`. Set
`DATABASE_URL` to a PostgreSQL connection string on that server and run `npm ci`
then `node lan/server.mjs ${PORT:-8642}`. The server creates its score table on
startup. Without a database, gameplay still works, but the scoreboard says it is
unavailable and no score is stored. Never place `DATABASE_URL` in `index.html` or
commit it. On Render, configure it as a secret environment variable on the web
service, and use a persistent PostgreSQL service. A free Render web service's
filesystem is erased on spin-down, restart and deploy; a free Render Postgres
instance expires after 30 days. Choose durable database service/backup policy
before publicly promising lasting records.

Each player chooses a public display name (up to 24 characters). The browser keeps
an anonymous local ID to hold one best result per player per board. Clearing
browser storage creates a new ID. The table shows the top 10 with times in
milliseconds, then mistakes as tiebreak, then earliest submission. Practice
boards have separate tables for deck, region, clue type, size and fair/classic
deal. Each daily puzzle number has its own table. Players submit a completed
result with a button; results are not uploaded automatically. The server
validates fields and board combinations, but cannot verify a solo game or
its timer: treat scores as friendly, self-reported competition. Old results
recorded before the millisecond clock cannot be submitted as precise times.

## Seasons

`SEASON_NUMBER` is an optional positive integer environment variable (defaults
to 1). Set it to 2 when starting a new database/season; the app never guesses
that an expiry and a season boundary happened at the same moment. The Season
button fetches a current snapshot from `/api/season`: distinct players and
boards with scores, plus the top 10 people by number of board records they
hold (a tie goes to the fastest of those records). The share card says
"standings so far" and can be copied any time while the database is live.
Before a free database expires, someone must copy or archive the summary.
The database's automatic expiry does not preserve the old season's scores,
create a new free database, or provide a post-expiry recap. The season
summary counts records by browser-local player ID, so a player using several
devices can appear more than once.
