// The walkthrough: one continuous session of the real game, driven with real mouse input
// against the served index.html. e2e/walkthrough.mjs runs it once per profile (desktop and
// phone), screenshots each step, records both sessions to MP4 and writes the promo manifest.
//
// Six steps carry `feature`; `order` is the position in the promo, which is not the order
// they are easiest to record in.

export const PROFILES = [
  { name: 'desktop', w: 1280, h: 800, dsf: 1.5 },
  { name: 'phone', w: 520, h: 1040, dsf: 2 },
];

/** Indices (into state.tiles, which is also #board child order) of one free matching pair. */
async function pairIndices(page) {
  return page.evaluate(() => {
    const m = findMove();
    return m ? m.map((t) => state.tiles.indexOf(t)) : null;
  });
}

async function clickTile(page, i, pace = 300) {
  const el = page.locator('#board .tile').nth(i);
  await el.hover();
  await page.waitForTimeout(Math.round(pace * 0.45));
  await el.click();
  await page.waitForTimeout(pace);
}

/** Clear `n` pairs (or the whole board when n is Infinity), shuffling if the board dead-ends. */
async function matchPairs(page, n, pace = 300) {
  for (let k = 0; k < n; k++) {
    if (await page.evaluate(() => state.done)) return;
    const m = await pairIndices(page);
    if (!m) {
      await page.locator('#btn-shuffle').click();
      await page.waitForTimeout(600);
      continue;
    }
    await clickTile(page, m[0], pace);
    await clickTile(page, m[1], pace);
  }
}

/** Two free tiles from different countries, for the wrong-pair shake. */
async function wrongPair(page) {
  const idx = await page.evaluate(() => {
    const free = freeTiles();
    for (let i = 0; i < free.length; i++)
      for (let j = i + 1; j < free.length; j++)
        if (free[i].code !== free[j].code) return [state.tiles.indexOf(free[i]), state.tiles.indexOf(free[j])];
    return null;
  });
  if (!idx) return;
  await clickTile(page, idx[0], 260);
  await clickTile(page, idx[1], 420);
}

export const STEPS = [
  {
    id: 'help',
    settleMs: 700,
    holdMs: 700,
    async run(page) {
      await page.locator('#sheet-help').waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'daily',
    settleMs: 900,
    holdMs: 900,
    feature: {
      order: 0,
      kind: 'Daily',
      title: 'One board a day. Same for everyone.',
      blurb: 'No. 1 landed on 11 September. Every player gets the identical deal, so the times are comparable and the bragging is fair.',
      clip: false,
    },
    async run(page) {
      await page.locator('#btn-help-close').click();
      await page.waitForTimeout(500);
      await page.locator('#board .tile.free').first().hover();
      await page.waitForTimeout(300);
    },
  },
  {
    id: 'match',
    settleMs: 400,
    holdMs: 500,
    feature: {
      order: 1,
      kind: 'How it plays',
      title: 'Pair a country with its capital',
      blurb: 'Tap a country, tap its capital, and the pair lifts off the board. A tile is free when nothing sits on it and one side is open, exactly like mahjong solitaire.',
      clip: true,
    },
    async run(page) {
      await matchPairs(page, 4, 380);
      await wrongPair(page);
    },
  },
  {
    id: 'hint',
    settleMs: 900,
    holdMs: 900,
    feature: {
      order: 2,
      kind: 'Hints',
      title: 'Stuck? Take a hint. It shows.',
      blurb: 'Hints and shuffles are always there. They ring the pair in gold and leave a gold square in your result, so a clean run means something.',
      clip: true,
    },
    async run(page) {
      await page.locator('#btn-hint').hover();
      await page.waitForTimeout(250);
      await page.locator('#btn-hint').click();
      await page.waitForTimeout(600);
    },
  },
  {
    id: 'finish',
    settleMs: 1000,
    async run(page) {
      await matchPairs(page, Infinity, 190);
      await page.locator('#sheet-end').waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'share',
    settleMs: 900,
    holdMs: 900,
    feature: {
      order: 4,
      kind: 'Share',
      title: 'Share the grid. Keep the streak.',
      blurb: 'Green for clean pairs, gold for help, red for a wrong guess first. Copy it, post it, and come back tomorrow for No. 2.',
      clip: false,
    },
    async run(page) {
      await page.locator('#btn-share').hover();
      await page.waitForTimeout(250);
      await page.locator('#btn-share').click();
      await page.waitForTimeout(400);
    },
  },
  {
    id: 'stats',
    settleMs: 900,
    holdMs: 900,
    feature: {
      order: 5,
      kind: 'Stats',
      title: 'Every day you play, counted',
      blurb: 'Played, streak, best streak, average and fastest times. It lives in your browser, the way the classics did.',
      clip: false,
    },
    async run(page) {
      await page.locator('#btn-close').click();
      await page.waitForTimeout(400);
      await page.locator('#btn-stats').click();
      await page.locator('#sheet-stats').waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(400);
    },
  },
  {
    id: 'flags',
    settleMs: 1000,
    holdMs: 900,
    feature: {
      order: 3,
      kind: 'Modes',
      title: 'Flags, currencies, populations too',
      blurb: 'The clue type changes daily. Practice has every mode, four board sizes and a classic random deal for purists.',
      clip: false,
    },
    async run(page) {
      await page.locator('#btn-stats-close').click();
      await page.waitForTimeout(300);
      await page.locator('#tab-practice').click();
      await page.waitForTimeout(500);
      await page.locator('label[for="mode-flag"]').click();
      await page.waitForTimeout(700);
      await matchPairs(page, 1, 320);
    },
  },
  {
    id: 'mix',
    settleMs: 900,
    async run(page) {
      await page.locator('label[for="size-24"]').click();
      await page.waitForTimeout(300);
      await page.locator('label[for="mode-mix"]').click();
      await page.waitForTimeout(700);
    },
  },
];

export const MANIFEST_META = {
  title: 'Mahgeong',
  tagline: 'The daily geography puzzle, played like mahjong.',
  outroLine: '197 countries. One board a day. How fast can you clear it?',
  cta: 'Mahgeong · play today’s board',
};
