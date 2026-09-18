// End-to-end check: plays real games start to finish in Chrome, on desktop and phone.
//
//   node e2e/playthrough.mjs
//
// Covers the daily board (fresh session, full clear to the end sheet), the practice tab
// (wrong-pair miss, blocked-tile nudge, hint, shuffle, full clear), and the phone layout.
// Any console error or page error fails the run. Screenshots land in out/verify/.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const GAME = resolve(here, "../../index.html");
const SHOTS = resolve(here, "../out/verify");
const PORT = 5187;
const HEAD = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';

mkdirSync(SHOTS, { recursive: true });

function serve() {
  const html = HEAD + readFileSync(GAME, "utf8") + "</body></html>";
  const srv = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html); });
  return new Promise(r => srv.listen(PORT, () => r(srv)));
}

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "ok  " : "ERR "} ${name}${cond ? "" : (extra ? " - " + extra : "")}`);
  if (!cond) failures++;
}

const pairIndices = page => page.evaluate(() => {
  const m = findMove();
  return m ? m.map(t => state.tiles.indexOf(t)) : null;
});

async function clearBoard(page, pace = 90) {
  for (let step = 0; step < 300; step++) {
    if (await page.evaluate(() => state.done)) return true;
    const m = await pairIndices(page);
    if (!m) { await page.locator("#btn-shuffle").click(); await page.waitForTimeout(pace * 3); continue; }
    await page.locator("#board .tile").nth(m[0]).click();
    await page.waitForTimeout(pace);
    await page.locator("#board .tile").nth(m[1]).click();
    await page.waitForTimeout(pace);
  }
  return page.evaluate(() => state.done);
}

async function newPage(browser, profile, errors) {
  const context = await browser.newContext({
    viewport: { width: profile.w, height: profile.h },
    deviceScaleFactor: 1,
    colorScheme: "light",
    ...(profile.mobile ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  page.on("console", m => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
  page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
  return { context, page };
}

const srv = await serve();
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });

// ---------- desktop: daily board, start to finish ----------
{
  const errors = [];
  const { context, page } = await newPage(browser, { w: 1366, h: 900 }, errors);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);

  check("daily: help sheet shows for a first-time player", await page.locator("#sheet-help").isVisible());
  await page.locator("#btn-help-close").click();
  const size = await page.evaluate(() => state.size);
  const nTiles = await page.locator("#board .tile").count();
  check(`daily: board mounts ${size * 2} tiles`, nTiles === size * 2, `got ${nTiles}`);
  check("daily: some tiles free, some blocked",
    (await page.locator("#board .tile.free").count()) > 0 && (await page.locator("#board .tile.blocked").count()) > 0);
  check("daily: layered tiles carry data-z", await page.evaluate(() =>
    state.tiles.every(t => t.el.dataset.z === String(t.z)) && new Set(state.tiles.map(t => t.z)).size > 1));
  await page.screenshot({ path: join(SHOTS, "desktop-daily-board.png") });

  check("daily: full clear reaches the end sheet", await clearBoard(page));
  await page.waitForTimeout(600);
  check("daily: end sheet visible with the day number", (await page.locator("#sheet-end").isVisible())
    && (await page.locator("#end-title").textContent()).includes(`No. ${await page.evaluate(() => state.n)} cleared`));
  check("daily: recap lists every pair", (await page.locator("#recap li").count()) === size);
  check("daily: share grid has one mark per pair", await page.evaluate(() => state.marks.length === state.size));
  check("daily: result persisted", await page.evaluate(() => {
    const res = JSON.parse(localStorage.getItem("mahgeong-results") || "{}");
    return !!res[state.n];
  }));
  await page.screenshot({ path: join(SHOTS, "desktop-daily-end.png") });
  check("daily: no console or page errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- desktop: practice tab, miss / nudge / hint / shuffle / clear ----------
{
  const errors = [];
  const { context, page } = await newPage(browser, { w: 1366, h: 900 }, errors);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
  await page.evaluate(() => { localStorage.setItem("mahgeong-help-seen", "1"); });
  await page.reload({ waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#tab-practice").click();
  await page.locator('label[for="size-12"]').click();
  await page.waitForTimeout(700);
  check("practice: 12-pair board mounts", (await page.locator("#board .tile").count()) === 24);

  // Wrong pair: two free tiles of different countries.
  const wrong = await page.evaluate(() => {
    const f = freeTiles();
    for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++)
      if (f[i].code !== f[j].code) return [state.tiles.indexOf(f[i]), state.tiles.indexOf(f[j])];
    return null;
  });
  check("practice: two different free tiles exist for the miss test", !!wrong);
  await page.locator("#board .tile").nth(wrong[0]).click();
  await page.waitForTimeout(120);
  await page.locator("#board .tile").nth(wrong[1]).click();
  await page.waitForTimeout(150);
  check("practice: wrong pair counts a miss and keeps both tiles", await page.evaluate(() =>
    state.mistakes === 1 && state.tiles.filter(t => t.alive).length === 24 && state.sel === -1));

  // Blocked tile: nudge only.
  const blocked = await page.evaluate(() => state.tiles.findIndex(t => t.alive && t.el.classList.contains("blocked")));
  check("practice: a blocked tile exists", blocked >= 0);
  await page.locator("#board .tile").nth(blocked).click({ force: true });
  await page.waitForTimeout(120);
  check("practice: blocked tile cannot be selected", await page.evaluate(() => state.sel === -1 && state.mistakes === 1));

  await page.locator("#btn-hint").click();
  await page.waitForTimeout(150);
  check("practice: hint counts and keeps the board whole", await page.evaluate(() =>
    state.hints === 1 && state.tiles.filter(t => t.alive).length === 24));

  const beforeShuffle = await page.evaluate(() => JSON.stringify(state.tiles.filter(t => t.alive).map(t => t.code + t.kind).sort()));
  await page.locator("#btn-shuffle").click();
  await page.waitForTimeout(300);
  check("practice: shuffle keeps pairings and a live move", await page.evaluate(() => state.shuffles === 1 && !!findMove())
    && (await page.evaluate(() => JSON.stringify(state.tiles.filter(t => t.alive).map(t => t.code + t.kind).sort()))) === beforeShuffle);

  check("practice: full clear reaches the end sheet", await clearBoard(page));
  await page.waitForTimeout(500);
  check("practice: end sheet says the board is cleared", (await page.locator("#end-title").textContent()).includes("cleared"));
  await page.screenshot({ path: join(SHOTS, "desktop-practice-end.png") });
  check("practice: no console or page errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- phone: portrait daily board is playable ----------
{
  const errors = [];
  const { context, page } = await newPage(browser, { w: 390, h: 844, mobile: true }, errors);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
  await page.evaluate(() => localStorage.setItem("mahgeong-help-seen", "1"));
  await page.reload({ waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  check("phone: daily board mounts on the portrait layout", await page.evaluate(() =>
    state.layout === "portrait" && state.tiles.every(t => t.el)));
  check("phone: tiles fit the viewport width", await page.evaluate(() => {
    const r = document.querySelector("#board").getBoundingClientRect();
    return r.left >= -1 && r.right <= window.innerWidth + 1;
  }));
  for (let k = 0; k < 3; k++) {
    const m = await pairIndices(page);
    if (!m) break;
    await page.locator("#board .tile").nth(m[0]).tap();
    await page.waitForTimeout(100);
    await page.locator("#board .tile").nth(m[1]).tap();
    await page.waitForTimeout(100);
  }
  check("phone: tap-to-match works", await page.evaluate(() => state.log.length >= 1));
  await page.screenshot({ path: join(SHOTS, "phone-daily-board.png") });
  check("phone: no console or page errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

await browser.close();
srv.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll playthrough checks passed");
process.exit(failures ? 1 : 0);
