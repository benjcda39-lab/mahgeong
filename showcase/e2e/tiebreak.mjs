// End-to-end check for sudden death: engineer a 9-9 cleared board, then the fresh
// four-tile sudden-death boards until one player answers cleanly after a rival's miss.
//
//   node e2e/tiebreak.mjs [base-url]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const SERVER = resolve(here, "../../lan/server.mjs");
const SHOTS = resolve(here, "../out/verify");
const PORT = 8645;
mkdirSync(SHOTS, { recursive: true });

let server = null;
let BASE = process.argv[2];
if (!BASE) {
  BASE = `http://127.0.0.1:${PORT}`;
  server = spawn("node", [SERVER, String(PORT)], { stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.on("data", d => process.stderr.write(`[server] ${d}`));
  await new Promise(r => server.stdout.on("data", function onData(d) {
    if (String(d).includes("two-player server")) { server.stdout.off("data", onData); r(); }
  }));
}

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "ERR "} ${name}${cond ? "" : (extra ? " - " + extra : "")}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });

async function newPlayer(name, profile) {
  const errors = [];
  const context = await browser.newContext({
    viewport: { width: profile.w, height: profile.h },
    deviceScaleFactor: 1, colorScheme: "light",
    ...(profile.mobile ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  page.on("console", m => { if (m.type() === "error") errors.push(`${name} console.error: ${m.text()}`); });
  page.on("pageerror", e => errors.push(`${name} pageerror: ${e.message}`));
  await page.goto(BASE, { waitUntil: "load" });
  await page.evaluate(() => localStorage.setItem("mahgeong-help-seen", "1"));
  await page.reload({ waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#tab-versus").click();
  return { name, context, page, errors };
}

const waitFn = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20000 });
const click = (page, i) => page.locator("#board .tile").nth(i).click({ force: true });

async function matchOne(page) {
  const m = await page.evaluate(() => {
    const mv = findMove();
    return mv ? mv.map(t => state.tiles.indexOf(t)) : null;
  });
  if (!m) return false;
  await click(page, m[0]);
  await page.waitForFunction(() => !!(vs && vs.pending), null, { timeout: 10000 });
  await click(page, m[1]);
  await page.waitForFunction(() => !vs.pending, null, { timeout: 10000 });
  return true;
}
async function missOne(page) {
  const idx = await page.evaluate(() => {
    const f = freeTiles();
    const withMate = f.find(t => f.some(o => o !== t && o.code === t.code));
    if (!withMate) return null;
    const wrong = f.find(o => o.code !== withMate.code);
    if (!wrong) return null;
    return { lock: state.tiles.indexOf(withMate), wrong: state.tiles.indexOf(wrong) };
  });
  if (!idx) return false;
  await click(page, idx.lock);
  await page.waitForFunction(() => !!(vs && vs.pending), null, { timeout: 10000 });
  await click(page, idx.wrong);
  await page.waitForFunction(() => !vs.pending, null, { timeout: 10000 });
  return true;
}

// Shuffle (turn player only) and retry when the scripted move is not on the board.
async function ensureMatch(page) {
  for (let tries = 0; tries < 4; tries++) {
    if (await matchOne(page)) return true;
    await page.locator("#btn-shuffle").click();
    await page.waitForTimeout(400);
  }
  return matchOne(page);
}
async function ensureMiss(page) {
  for (let tries = 0; tries < 4; tries++) {
    if (await missOne(page)) return true;
    await page.locator("#btn-shuffle").click();
    await page.waitForTimeout(400);
  }
  return missOne(page);
}

const A = await newPlayer("Alice", { w: 1280, h: 800 });
const B = await newPlayer("Bob", { w: 390, h: 844, mobile: true });

// --- fast lobby path: join + both ready ---
await A.page.locator("#v-name").fill("Alice");
await A.page.locator("#v-create").click();
await waitFn(A.page, () => vs && vs.room && vs.status === "waiting");
const code = await A.page.evaluate(() => vs.room);
await B.page.locator("#v-name").fill("Bob");
await B.page.locator("#v-code").fill(code);
await B.page.locator("#v-join").click();
await waitFn(B.page, () => vs && vs.status === "waiting" && vs.names.A === "Alice");
await A.page.locator("#v-ready").click();
await B.page.locator("#v-ready").click();
await waitFn(A.page, () => vs.status === "playing" && state && state.tiles.length === 36);
await waitFn(B.page, () => vs.status === "playing" && state && state.tiles.length === 36);
check("start: the game opens on both screens", true);

// --- engineer a 9-9 tie: nine [Alice miss, Bob match, Bob miss] macros leave the
// --- board at (0,9) with Alice to move and nine pairs left; Alice then matches out.
// --- Her last match lands exactly (9,9): regulation ends level, sudden death starts.
for (let macro = 1; macro <= 9; macro++) {
  const okMissA = await ensureMiss(A.page);
  const okMatchB = okMissA && await ensureMatch(B.page);
  const okMissB = okMatchB && await ensureMiss(B.page);
  if (!okMissB) { check(`tie: engineered macro ${macro}`, false, "a move was not available"); break; }
  await waitFn(A.page, m => vs.scores.A === 0 && vs.scores.B === m && vs.turn === "A", macro);
}
const mid = await A.page.evaluate(() => ({ scores: { ...vs.scores }, turn: vs.turn, alive: state.tiles.filter(t => t.alive).length }));
check("tie: nine macros leave (0,9), Alice to move, nine pairs left",
  mid.scores.A === 0 && mid.scores.B === 9 && mid.turn === "A" && mid.alive === 18, JSON.stringify(mid));
for (let pair = 1; pair <= 9; pair++) {
  const ok = await ensureMatch(A.page);
  if (!ok) { check(`tie: Alice sweep pair ${pair}`, false, "no move"); break; }
}
await waitFn(A.page, () => vs.tb === true && vs.status === "playing");
await waitFn(B.page, () => vs.tb === true && vs.status === "playing");
const tieA = await A.page.evaluate(() => ({ scores: { ...vs.scores } }));
check("tie: regulation ends 9-9 with the board cleared", tieA.scores.A === 9 && tieA.scores.B === 9, JSON.stringify(tieA));

// --- sudden death: a fresh four-tile board with exactly one true pair ---
const sdInfo = await A.page.evaluate(() => {
  const alive = state.tiles.filter(t => t.alive);
  const counts = {};
  alive.forEach(t => { counts[t.code] = (counts[t.code] || 0) + 1; });
  return { alive: alive.length, pairs: Object.values(counts).filter(n => n === 2).length };
});
check("tiebreak: a fresh four-tile board is dealt", sdInfo.alive === 4, JSON.stringify(sdInfo));
check("tiebreak: exactly one true pair is on the board", sdInfo.pairs === 1, JSON.stringify(sdInfo));
check("tiebreak: Alice (last to match) holds the first attempt", (await A.page.evaluate(() => vs.turn)) === "A");
check("tiebreak: both screens say sudden death", /sudden death/i.test(await A.page.locator("#v-status").textContent())
  && /sudden death/i.test(await B.page.locator("#v-status").textContent()));

// --- Alice misses; Bob answers cleanly: Bob takes the match ---
const missOk = await missOne(A.page);
check("tiebreak: Alice's attempt misses", missOk);
await waitFn(B.page, () => vs.turn === "B" && vs.tb === true && vs.status === "playing");
const sd2 = await B.page.evaluate(() => state.tiles.filter(t => t.alive).length);
check("tiebreak: each attempt gets a fresh board", sd2 === 4);
const hitOk = await matchOne(B.page);
check("tiebreak: Bob answers cleanly", hitOk);
await waitFn(A.page, () => vs.status === "done");
await waitFn(B.page, () => vs.status === "done");
const [wA, wB] = await Promise.all([
  A.page.evaluate(() => ({ winner: vs.winner, sd: vs.sdwin })),
  B.page.evaluate(() => ({ winner: vs.winner, sd: vs.sdwin })),
]);
check("tiebreak: a clean answer after a rival's miss wins", wA.winner === "B" && wA.sd === true && wB.winner === "B" && wB.sd === true, JSON.stringify(wA));
check("tiebreak: both players see the result", /wins/i.test(await A.page.locator("#v-status").textContent())
  && /you win/i.test(await B.page.locator("#v-status").textContent()));
await A.page.screenshot({ path: join(SHOTS, "tiebreak-desktop.png") });
await B.page.screenshot({ path: join(SHOTS, "tiebreak-phone.png") });

const errors = [...A.errors, ...B.errors];
check("tiebreak: no console or page errors anywhere", errors.length === 0, errors.join(" | "));

await browser.close();
if (server) server.kill();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll tiebreak checks passed");
process.exit(failures ? 1 : 0);
