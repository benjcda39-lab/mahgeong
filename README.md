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
