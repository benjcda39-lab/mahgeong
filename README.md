# Mahgeong

A daily geography puzzle played like mahjong solitaire. Clear the board by pairing each country with its capital, flag, currency or population. One board a day, the same for everyone, then a shareable result grid and a streak.

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

## Public site (GitHub Pages)

`index.html` has no page wrapper because the artifact host adds one. For GitHub Pages, `node build-pages.mjs` writes a wrapped copy to `docs/index.html`, and Pages serves the `docs` folder from `main`. Run the build and commit `docs/` after every change to `index.html`.
