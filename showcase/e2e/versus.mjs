// End-to-end check for turn-based round play: committed-tile turns, penalties, reconnect
// while locked, round transitions, and the early 2-0 championship finish.
//
//   node e2e/versus.mjs [base-url]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const SERVER = resolve(here, "../../lan/server.mjs");
const SHOTS = resolve(here, "../out/verify");
const PORT = 8643;
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
const aliveCount = page => page.evaluate(() => state && state.kind === "versus" ? state.tiles.filter(t => t.alive).length : -1);
const click = (page, i) => page.locator("#board .tile").nth(i).click({ force: true });
const snap = page => page.evaluate(() => ({ scores: { ...vs.scores }, misses: { ...vs.misses }, turn: vs.turn, status: vs.status, phase: vs.phase, round: vs.round, roundWins: { ...vs.roundWins }, pending: vs.pending ? { ...vs.pending } : null, champion: vs.champion }));

async function matchOne(page) {
  const m = await page.evaluate(() => {
    const mv = findMove();
    return mv ? mv.map(t => state.tiles.indexOf(t)) : null;
  });
  if (!m) return false;
  const before = await page.evaluate(() => state.tiles.filter(t => t.alive).length);
  await click(page, m[0]);
  await page.waitForFunction(() => !!(vs && vs.pending), null, { timeout: 10000 });
  await click(page, m[1]);
  await page.waitForFunction(n => state.tiles.filter(t => t.alive).length === n, before - 2, { timeout: 10000 });
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
async function deadOne(page) {
  const i = await page.evaluate(() => {
    const f = freeTiles();
    const dead = f.find(t => !f.some(o => o !== t && o.code === t.code));
    return dead ? state.tiles.indexOf(dead) : null;
  });
  if (i == null) return false;
  await click(page, i);
  await page.waitForFunction(() => !vs.pending, null, { timeout: 10000 });
  return true;
}
// Sweep the current board with the current-turn player until the round ends.
async function sweepRound(A, B) {
  for (let step = 0; step < 200; step++) {
    const st = await A.page.evaluate(() => ({ status: vs.status, phase: vs.phase, turn: vs.turn }));
    if (st.status !== "playing") return st;
    const mover = st.turn === "A" ? A.page : B.page;
    const other = st.turn === "A" ? B.page : A.page;
    const before = await aliveCount(mover);
    let moved = await matchOne(mover);
    if (!moved) {
      await mover.locator("#btn-shuffle").click();
      await mover.waitForFunction(() => !!findMove(), null, { timeout: 10000 });
      continue;
    }
    await waitFn(other, n => state.tiles.filter(t => t.alive).length === n, before - 2);
  }
  throw new Error("round did not end in 200 steps");
}

const A = await newPlayer("Alice", { w: 1280, h: 800 });
const B = await newPlayer("Bob", { w: 390, h: 844, mobile: true });

// --- fast lobby path: draft + ready ---
await A.page.locator("#v-name").fill("Alice");
await A.page.locator("#v-create").click();
await waitFn(A.page, () => vs && vs.room && vs.phase === "veto");
const code = await A.page.evaluate(() => vs.room);
await B.page.locator("#v-name").fill("Bob");
await B.page.locator("#v-code").fill(code);
await B.page.locator("#v-join").click();
await waitFn(B.page, () => vs && vs.phase === "veto" && vs.names.A === "Alice");
await A.page.locator('[data-cat="populations"]').click();
await waitFn(B.page, () => vs.vetoes.length === 1);
await B.page.locator('[data-cat="currencies"]').click();
await waitFn(A.page, () => vs.vetoes.length === 2);
await A.page.locator('[data-cat="presidents"]').click();
await waitFn(B.page, () => vs.vetoes.length === 3);
await B.page.locator('[data-cat="state-flags"]').click();
await waitFn(A.page, () => vs.phase === "ready");
await A.page.locator("#v-ready").click();
await B.page.locator("#v-ready").click();
await waitFn(A.page, () => vs.status === "playing" && vs.round === 1);
await waitFn(B.page, () => vs.status === "playing" && vs.round === 1 && state && state.kind === "versus");
check("start: draft plus both ready opens round 1 on both screens", true);

const [tilesA, tilesB] = await Promise.all([
  A.page.evaluate(() => state.tiles.map(t => t.code + ":" + t.kind).sort().join("|")),
  B.page.evaluate(() => state.tiles.map(t => t.code + ":" + t.kind).sort().join("|")),
]);
check("deal: both players see the same 18 pairs", tilesA === tilesB && tilesA.split("|").length === 36);
check("deal: round 1 pairs are all capitals", (await A.page.evaluate(() => state.tiles.every(t => t.kind === "name" || t.kind === "capital"))));
check("deal: phone player is on the portrait layout", await B.page.evaluate(() => state.layout === "portrait"));
await A.page.screenshot({ path: join(SHOTS, "versus-desktop.png") });
await B.page.screenshot({ path: join(SHOTS, "versus-phone.png") });

// --- out of turn: Bob cannot act, client-side and server-side ---
check("turn: Alice has the first turn", (await snap(A.page)).turn === "A");
await B.page.evaluate(() => {
  const mv = findMove();
  if (mv) onVersusTile(state.tiles.indexOf(mv[0]), mv[0]);
});
await B.page.waitForTimeout(400);
let sb = await snap(B.page);
check("turn: out-of-turn tap is blocked on the client", !sb.pending && sb.turn === "A" && sb.scores.B === 0);
await B.page.evaluate(() => vs.ws.send(JSON.stringify({ t: "select", i: 0 })));
await B.page.waitForTimeout(400);
sb = await snap(B.page);
check("turn: out-of-turn select is rejected by the server", !sb.pending && sb.turn === "A" && sb.scores.A === 0 && sb.scores.B === 0);

// --- Alice: correct pair scores and keeps the turn; the lock clears on both screens ---
await matchOne(A.page);
let sa = await snap(A.page);
check("score: correct pair is a point", sa.scores.A === 1 && sa.scores.B === 0, JSON.stringify(sa));
check("turn: a correct pair keeps the turn", sa.turn === "A" && !sa.pending);
await waitFn(B.page, () => vs.scores.A === 1 && !vs.pending);
check("sync: Bob sees Alice's point, the cleared lock, and still her turn", (await snap(B.page)).turn === "A");

// --- Alice: wrong pick transfers a point to Bob and passes the turn ---
await missOne(A.page);
sa = await snap(A.page);
check("penalty: wrong pick is -1 to Alice, +1 to Bob", sa.scores.A === 0 && sa.scores.B === 1, JSON.stringify(sa));
check("turn: a failed resolution passes the turn", sa.turn === "A" ? false : sa.turn === "B");
await waitFn(B.page, () => vs.turn === "B" && vs.scores.B === 1);
sb = await snap(B.page);
check("sync: Bob sees his point and his turn", sb.turn === "B" && sb.scores.B === 1, JSON.stringify(sb));

// --- Bob locks a tile with no free match: dead lock, penalized at once ---
let deadOk = await deadOne(B.page);
for (let tries = 0; !deadOk && tries < 3; tries++) { await matchOne(B.page); deadOk = await deadOne(B.page); }
check("penalty: committing a tile with no free match fails the turn", deadOk);
sb = await snap(B.page);
check("penalty: dead lock is -1 to Bob, +1 to Alice, turn passes", sb.scores.B === 0 && sb.scores.A === 1 && sb.turn === "A", JSON.stringify(sb));

// --- no deselect: tapping the locked tile again keeps it locked, then resolve ---
await A.page.evaluate(() => {
  const mv = findMove();
  window.__lock = state.tiles.indexOf(mv[0]); window.__mate = state.tiles.indexOf(mv[1]);
  onVersusTile(window.__lock, state.tiles[window.__lock]);
});
await waitFn(A.page, () => !!vs.pending);
const lockIdx = await A.page.evaluate(() => window.__lock);
await click(A.page, lockIdx);
await A.page.waitForTimeout(400);
check("turn: tapping the locked tile again does not deselect it", await A.page.evaluate(() => !!vs.pending && state.sel === vs.pending.tile));
await A.page.evaluate(() => onVersusTile(window.__mate, state.tiles[window.__mate]));
await waitFn(A.page, () => !vs.pending && vs.scores.A === 2);
check("score: resolving the lock scores after the deselect attempt", true);

// --- reconnect while locked: Alice commits, vanishes, rejoins still locked ---
await A.page.evaluate(() => {
  const mv = findMove();
  onVersusTile(state.tiles.indexOf(mv[0]), mv[0]);
});
await waitFn(A.page, () => !!vs.pending);
const preDisc = await snap(A.page);
await A.page.close();
await waitFn(B.page, () => vs.connected.A === false);
const A2page = await A.context.newPage();
A2page.on("console", m => { if (m.type() === "error") A.errors.push(`A2 console.error: ${m.text()}`); });
A2page.on("pageerror", e => A.errors.push(`A2 pageerror: ${e.message}`));
await A2page.goto(BASE, { waitUntil: "load" });
await A2page.locator("#tab-versus").click();
await waitFn(A2page, () => vs && vs.status === "playing" && !!vs.pending && vs.turn === "A");
const sa2 = await snap(A2page);
check("reconnect: a locked selection survives reconnect", sa2.pending && sa2.pending.seat === "A"
  && (await A2page.evaluate(() => state.sel)) === (await A2page.evaluate(() => vs.pending.tile)));
check("reconnect: turn and scores preserved", sa2.turn === "A" && sa2.scores.A === preDisc.scores.A && sa2.scores.B === preDisc.scores.B, JSON.stringify(sa2));
A.page = A2page;

// --- Alice sweeps round 1; the lobby reopens between rounds ---
await sweepRound(A, B);
await waitFn(A.page, () => vs.status === "waiting" && vs.phase === "between");
await waitFn(B.page, () => vs.status === "waiting" && vs.phase === "between");
let ra = await snap(A.page);
check("round: Alice takes round 1", ra.roundWins.A === 1 && ra.roundWins.B === 0 && ra.lastRoundWinner === "A", JSON.stringify(ra));
check("round: both lobbies show the round result and the next category",
  (await A.page.locator("#v-lobby-title").textContent()).includes("Round 1 to you")
  && (await B.page.locator("#v-lobby-note").textContent()).toLowerCase().includes("next round"));

// --- both ready: round 2 starts with fresh scores and Bob's turn ---
await A.page.locator("#v-ready").click();
await B.page.locator("#v-ready").click();
await waitFn(A.page, () => vs.status === "playing" && vs.round === 2);
await waitFn(B.page, () => vs.status === "playing" && vs.round === 2 && state.tiles.length === 36);
ra = await snap(A.page);
check("round: round 2 starts fresh on the second category", ra.round === 2 && ra.scores.A === 0 && ra.scores.B === 0 && ra.turn === "B", JSON.stringify(ra));
check("round: round 2 pairs are all flags", (await A.page.evaluate(() => state.tiles.every(t => t.kind === "name" || t.kind === "flag"))));

// --- Bob yields the turn; Alice sweeps again: immediate 2-0 championship ---
await missOne(B.page);
check("round: Bob's miss hands Alice the turn", (await snap(A.page)).turn === "A");
await sweepRound(A, B);
await waitFn(A.page, () => vs.status === "done");
await waitFn(B.page, () => vs.status === "done");
const [endA, endB] = await Promise.all([
  A.page.evaluate(() => ({ roundWins: { ...vs.roundWins }, champion: vs.champion, status: vs.status })),
  B.page.evaluate(() => ({ roundWins: { ...vs.roundWins }, champion: vs.champion, status: vs.status })),
]);
check("end: the match ends immediately at two round wins", endA.roundWins.A === 2 && endA.roundWins.B === 0, JSON.stringify(endA));
check("end: a single agreed champion on both screens", endA.champion === "A" && endB.champion === "A", JSON.stringify(endB));
check("end: both players see the champion", (await A.page.locator("#v-status").textContent()).match(/Champion/i) !== null
  && (await B.page.locator("#v-status").textContent()).match(/[Cc]hampion/i) !== null);
await A.page.screenshot({ path: join(SHOTS, "versus-end-desktop.png") });
await B.page.screenshot({ path: join(SHOTS, "versus-end-phone.png") });

const errors = [...A.errors, ...B.errors];
check("versus: no console or page errors anywhere", errors.length === 0, errors.join(" | "));

await browser.close();
if (server) server.kill();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll versus checks passed");
process.exit(failures ? 1 : 0);
