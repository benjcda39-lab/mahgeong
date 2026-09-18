// End-to-end check for tied rounds and same-category sudden death: engineers a level
// round 1, resolves it in sudden death, forces a 1-1 decider, and crowns one champion.
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

const matchIdx = `(() => { const mv = findMove(); return mv ? { lock: state.tiles.indexOf(mv[0]), tap: state.tiles.indexOf(mv[1]) } : null; })()`;
const missIdx = `(() => {
  const f = freeTiles();
  const withMate = f.find(t => f.some(o => o !== t && o.code === t.code));
  if (!withMate) return null;
  const wrong = f.find(o => o.code !== withMate.code);
  return wrong ? { lock: state.tiles.indexOf(withMate), tap: state.tiles.indexOf(wrong) } : null;
})()`;

async function play(page, idx) {
  await click(page, idx.lock);
  await page.waitForFunction(() => !!(vs && vs.pending), null, { timeout: 10000 });
  await click(page, idx.tap);
  await page.waitForFunction(() => !vs.pending, null, { timeout: 10000 });
}

const A = await newPlayer("Alice", { w: 1280, h: 800 });
const B = await newPlayer("Bob", { w: 390, h: 844, mobile: true });

// --- fast lobby path ---
await A.page.locator("#v-name").fill("Alice");
await A.page.locator("#v-create").click();
await waitFn(A.page, () => vs && vs.room && vs.phase === "veto");
const code = await A.page.evaluate(() => vs.room);
await B.page.locator("#v-name").fill("Bob");
await B.page.locator("#v-code").fill(code);
await B.page.locator("#v-join").click();
await waitFn(B.page, () => vs && vs.phase === "veto" && vs.names.A === "Alice");
let vetoCount = 0;
for (const [p, cat] of [[A, "populations"], [B, "currencies"], [A, "presidents"], [B, "state-flags"]]) {
  vetoCount++;
  await p.page.locator(`[data-cat="${cat}"]`).click();
  await A.page.waitForFunction(n => vs.vetoes.length === n, vetoCount, { timeout: 15000 });
  await B.page.waitForFunction(n => vs.vetoes.length === n, vetoCount, { timeout: 15000 });
}
await A.page.waitForFunction(() => vs.phase === "ready", null, { timeout: 15000 });
await A.page.locator("#v-ready").click();
await B.page.locator("#v-ready").click();
await waitFn(A.page, () => vs.status === "playing" && vs.round === 1);
await waitFn(B.page, () => vs.status === "playing" && vs.round === 1);
check("start: draft plus both ready opens round 1", true);

// --- engineer a tied round 1: each cycle is Alice +1/-1, Bob +1/-1, two pairs cleared ---
for (let cycle = 0; cycle < 9; cycle++) {
  for (const actor of [A, B]) {
    let idx = await actor.page.evaluate(matchIdx);
    for (let guard = 0; !idx && guard < 4; guard++) {
      await actor.page.locator("#btn-shuffle").click();
      await actor.page.waitForFunction(() => !!findMove(), null, { timeout: 10000 });
      idx = await actor.page.evaluate(matchIdx);
    }
    if (!idx) throw new Error(`no move for cycle ${cycle}`);
    await play(actor.page, idx);
    const miss = await actor.page.evaluate(missIdx);
    if (!miss) throw new Error(`no wrong tile for cycle ${cycle}`);
    await play(actor.page, miss);
  }
}
await waitFn(A.page, () => vs.tb === true);
await waitFn(B.page, () => vs.tb === true);
const reg = await A.page.evaluate(() => ({ scores: { ...vs.scores }, status: vs.status, tb: vs.tb, round: vs.round }));
check("tie: round 1 ends level and launches sudden death", reg.status === "playing" && reg.tb === true && reg.scores.A === reg.scores.B, JSON.stringify(reg));

// --- sudden death board: four fresh tiles from the SAME category, exactly one true pair ---
const sdInfo = await A.page.evaluate(() => {
  const f = freeTiles();
  let pairs = 0;
  for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) if (f[i].code === f[j].code) pairs++;
  return { alive: state.tiles.filter(t => t.alive).length, free: f.length, pairs, kinds: [...new Set(state.tiles.map(t => t.kind))].sort().join(","), roundCat: vs.rounds[vs.round - 1] };
});
check("tiebreak: fresh four-tile board, all free, exactly one true pair", sdInfo.alive === 4 && sdInfo.free === 4 && sdInfo.pairs === 1, JSON.stringify(sdInfo));
check("tiebreak: content is from the tied round's category", sdInfo.kinds === "capital,name", sdInfo.kinds);
await A.page.screenshot({ path: join(SHOTS, "suddendeath-desktop.png") });
await B.page.screenshot({ path: join(SHOTS, "suddendeath-phone.png") });

// --- the turn player misses; the rival answers cleanly and takes the round ---
const firstUp = await A.page.evaluate(() => vs.turn);
const first = firstUp === "A" ? A : B;
const second = firstUp === "A" ? B : A;
const miss1 = await first.page.evaluate(missIdx);
await play(first.page, miss1);
await waitFn(second.page, () => vs.turn !== "" + (firstUp) && state.tiles.filter(t => t.alive).length === 4 && vs.status === "playing");
check("tiebreak: a miss passes the turn on a fresh same-category board", true);
const winIdx = await second.page.evaluate(matchIdx);
check("tiebreak: the rival's board has its one true pair", !!winIdx);
await play(second.page, winIdx);
await waitFn(A.page, () => vs.status === "waiting" && vs.phase === "between");
await waitFn(B.page, () => vs.status === "waiting" && vs.phase === "between");
const rw = await A.page.evaluate(() => ({ ...vs.roundWins, last: vs.lastRoundWinner }));
check("tiebreak: clean answer after the rival's miss takes the round", rw.last === (firstUp === "A" ? "B" : "A") && rw[firstUp === "A" ? "B" : "A"] === 1, JSON.stringify(rw));
check("tiebreak: both lobbies show the sudden-death round result", (await A.page.locator("#v-lobby-title").textContent()).match(/sudden death/i) !== null);

// --- round 2 to Alice, round 3 to Alice: a 2-1 decider crowns the champion ---
await A.page.locator("#v-ready").click();
await B.page.locator("#v-ready").click();
await waitFn(A.page, () => vs.status === "playing" && vs.round === 2);
check("decider: round 2 opens after the between-rounds lobby", true);
// Bob (first turn in round 2) yields; Alice sweeps.
{
  const miss = await B.page.evaluate(missIdx);
  if (miss) await play(B.page, miss);
}
for (let step = 0; step < 200; step++) {
  const st = await A.page.evaluate(() => ({ status: vs.status, phase: vs.phase, turn: vs.turn, round: vs.round }));
  if (st.status !== "playing") break;
  const actor = st.turn === "A" ? A : B;
  let idx = await actor.page.evaluate(matchIdx);
  if (!idx) { await actor.page.locator("#btn-shuffle").click(); await actor.page.waitForFunction(() => !!findMove(), null, { timeout: 10000 }); continue; }
  await play(actor.page, idx);
}
await waitFn(A.page, () => vs.status === "waiting" && vs.phase === "between" && vs.roundWins.A === 1 && vs.roundWins.B === 1);
check("decider: round 2 levels the match at 1-1", true);
await A.page.locator("#v-ready").click();
await B.page.locator("#v-ready").click();
await waitFn(A.page, () => vs.status === "playing" && vs.round === 3);
check("decider: round 3 opens", true);
for (let step = 0; step < 200; step++) {
  const st = await A.page.evaluate(() => ({ status: vs.status, turn: vs.turn }));
  if (st.status !== "playing") break;
  const actor = st.turn === "A" ? A : B;
  let idx = await actor.page.evaluate(matchIdx);
  if (!idx) { await actor.page.locator("#btn-shuffle").click(); await actor.page.waitForFunction(() => !!findMove(), null, { timeout: 10000 }); continue; }
  await play(actor.page, idx);
}
await waitFn(A.page, () => vs.status === "done");
await waitFn(B.page, () => vs.status === "done");
const [cA, cB] = await Promise.all([
  A.page.evaluate(() => ({ champion: vs.champion, roundWins: { ...vs.roundWins } })),
  B.page.evaluate(() => ({ champion: vs.champion, roundWins: { ...vs.roundWins } })),
]);
check("decider: one agreed champion on both screens", cA.champion === cB.champion && !!cA.champion
  && Math.max(cA.roundWins.A, cA.roundWins.B) === 2, JSON.stringify(cA));
check("decider: both players see the champion", (await A.page.locator("#v-status").textContent()).match(/[Cc]hampion/) !== null
  && (await B.page.locator("#v-status").textContent()).match(/[Cc]hampion/) !== null);
await A.page.screenshot({ path: join(SHOTS, "suddendeath-end-desktop.png") });
await B.page.screenshot({ path: join(SHOTS, "suddendeath-end-phone.png") });

const errors = [...A.errors, ...B.errors];
check("tiebreak: no console or page errors anywhere", errors.length === 0, errors.join(" | "));

await browser.close();
if (server) server.kill();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll tiebreak checks passed");
process.exit(failures ? 1 : 0);
