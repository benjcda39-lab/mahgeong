// End-to-end check for the one-off turn-based game: committed-tile turns, penalties,
// reconnect while locked, and a full sweep to the winner.
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
const snap = page => page.evaluate(() => ({ scores: { ...vs.scores }, misses: { ...vs.misses }, turn: vs.turn, status: vs.status, winner: vs.winner, pending: vs.pending ? { ...vs.pending } : null, tb: vs.tb, sdwin: vs.sdwin }));

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
  const pre = await page.evaluate(() => vs.misses[vs.seat]);
  await click(page, i);
  try {
    await page.waitForFunction(m => vs.misses[vs.seat] > m, pre, { timeout: 10000 });
    return true;
  } catch { return false; }
}
// Sweep the board with the current-turn player until the game ends.
async function sweepRound(A, B) {
  for (let step = 0; step < 200; step++) {
    const st = await A.page.evaluate(() => ({ status: vs.status, turn: vs.turn }));
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
  throw new Error("game did not end in 200 steps");
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
await waitFn(A.page, () => vs.status === "playing");
await waitFn(B.page, () => vs.status === "playing" && state && state.kind === "versus");
check("start: both ready opens the game on both screens", true);

const [tilesA, tilesB] = await Promise.all([
  A.page.evaluate(() => state.tiles.map(t => t.code + ":" + t.kind).sort().join("|")),
  B.page.evaluate(() => state.tiles.map(t => t.code + ":" + t.kind).sort().join("|")),
]);
check("deal: both players see the same 18 pairs", tilesA === tilesB && tilesA.split("|").length === 36);
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
check("turn: a correct pair keeps the turn and clears the lock", sa.turn === "A" && !sa.pending);
await waitFn(B.page, () => vs.scores.A === 1 && !vs.pending);
check("sync: Bob sees Alice's point, the cleared lock, and still her turn", (await snap(B.page)).turn === "A");

// --- Alice: wrong pick transfers a point to Bob and passes the turn ---
await missOne(A.page);
sa = await snap(A.page);
check("penalty: wrong pick is -1 to Alice, +1 to Bob", sa.scores.A === 0 && sa.scores.B === 1, JSON.stringify(sa));
check("turn: a failed resolution passes the turn", sa.turn === "B");
await waitFn(B.page, () => vs.turn === "B" && vs.scores.B === 1);
sb = await snap(B.page);
check("sync: Bob sees his point and his turn", sb.turn === "B" && sb.scores.B === 1, JSON.stringify(sb));

// --- Bob locks a tile with no free match: dead lock, penalized at once ---
const preDead = await snap(B.page);
let deadOk = await deadOne(B.page);
let bMatches = 0;
for (let tries = 0; !deadOk && tries < 4; tries++) {
  const st = await snap(B.page);
  if (st.turn !== "B") break;
  if (await matchOne(B.page)) bMatches++;
  deadOk = await deadOne(B.page);
}
check("penalty: committing a tile with no free match fails the turn", deadOk);
sb = await snap(B.page);
check("penalty: dead lock is -1 to Bob, +1 to Alice, turn passes",
  sb.scores.B === preDead.scores.B + bMatches - 1 && sb.scores.A === preDead.scores.A + 1 && sb.turn === "A", JSON.stringify(sb));
const aBase = sb.scores.A;

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
await waitFn(A.page, base => !vs.pending && vs.scores.A === base + 1, aBase);
check("score: resolving the lock scores after the deselect attempt", true);

// --- reconnect while locked: Alice commits, vanishes, rejoins still locked, resolves ---
await A.page.evaluate(() => {
  const mv = findMove();
  window.__lock2 = state.tiles.indexOf(mv[0]);
  onVersusTile(window.__lock2, mv[0]);
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
await A.page.evaluate(() => {
  const lock = vs.pending.tile;
  const mate = freeTiles().find(t => state.tiles.indexOf(t) !== lock && t.code === state.tiles[lock].code);
  onVersusTile(state.tiles.indexOf(mate), mate);
});
await waitFn(A.page, base => !vs.pending && vs.scores.A === base + 1, preDisc.scores.A);
check("reconnect: the rejoined player resolves the lock", true);

// --- Alice sweeps the board; the game ends with a single agreed winner ---
await sweepRound(A, B);
await waitFn(A.page, () => vs.status === "done");
await waitFn(B.page, () => vs.status === "done");
const [endA, endB] = await Promise.all([snap(A.page), snap(B.page)]);
check("end: Alice wins the cleared board", endA.winner === "A" && endB.winner === "A" && endA.scores.A > endA.scores.B, JSON.stringify(endA));
check("end: both players see the result", /you win/i.test(await A.page.locator("#v-status").textContent())
  && /wins/i.test(await B.page.locator("#v-status").textContent()));
await A.page.screenshot({ path: join(SHOTS, "versus-end-desktop.png") });
await B.page.screenshot({ path: join(SHOTS, "versus-end-phone.png") });

const errors = [...A.errors, ...B.errors];
check("versus: no console or page errors anywhere", errors.length === 0, errors.join(" | "));

await browser.close();
if (server) server.kill();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll versus checks passed");
process.exit(failures ? 1 : 0);
