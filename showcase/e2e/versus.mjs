// End-to-end check for two-player LAN play: boots the real lan/server.mjs, then drives
// two Chrome sessions (a desktop and a phone) through hosting, joining, racing to clear
// the shared board, a mid-game disconnect/reconnect, and a bad room code.
//
//   node e2e/versus.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const SERVER = resolve(here, "../../lan/server.mjs");
const SHOTS = resolve(here, "../out/verify");
const PORT = 8643;
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "ERR "} ${name}${cond ? "" : (extra ? " - " + extra : "")}`);
  if (!cond) failures++;
};

const server = spawn("node", [SERVER, String(PORT)], { stdio: ["ignore", "pipe", "pipe"] });
server.stderr.on("data", d => process.stderr.write(`[server] ${d}`));
await new Promise(r => server.stdout.on("data", function onData(d) {
  if (String(d).includes("two-player server")) { server.stdout.off("data", onData); r(); }
}));

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

const waitFn = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000 });
const aliveCount = page => page.evaluate(() => state && state.kind === "versus" ? state.tiles.filter(t => t.alive).length : -1);
const click = (page, i) => page.locator("#board .tile").nth(i).click({ force: true });

// Match one pair. An opponent's broadcast can legitimately clear a half-made selection
// between the two clicks (the second click then just re-selects), so retry a few times.
async function matchOne(page) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const m = await page.evaluate(() => {
      const mv = findMove();
      return mv ? mv.map(t => state.tiles.indexOf(t)) : null;
    });
    if (!m) return false;
    const before = await page.evaluate(() => state.tiles.filter(t => t.alive).length);
    await click(page, m[0]);
    await click(page, m[1]);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => state.tiles.filter(t => t.alive).length);
    if (after === before - 2) return true;
  }
  return false;
}

const A = await newPlayer("Alice", { w: 1280, h: 800 });
const B = await newPlayer("Bob", { w: 390, h: 844, mobile: true });

// --- host and join ---
await A.page.locator("#v-name").fill("Alice");
await A.page.locator("#v-create").click();
await waitFn(A.page, () => vs && vs.room && vs.status === "waiting");
const code = await A.page.evaluate(() => vs.room);
check("host: room created with a 4-letter code", /^[A-Z]{4}$/.test(code), code);
check("host: status shows the code to share", (await A.page.locator("#v-status").textContent()).includes(code));

// Bad code first: Bob tries ZZZZ.
await B.page.locator("#v-name").fill("Bob");
await B.page.locator("#v-code").fill("ZZZZ");
await B.page.locator("#v-join").click();
await B.page.waitForFunction(() => document.getElementById("v-status").textContent.includes("No room"), null, { timeout: 10000 });
check("join: a bad room code is rejected cleanly", true);

await B.page.locator("#v-code").fill(code);
await B.page.locator("#v-join").click();
await waitFn(A.page, () => vs.status === "playing");
await waitFn(B.page, () => vs.status === "playing" && state && state.kind === "versus");
check("join: both players are in and playing", true);

const [tilesA, tilesB] = await Promise.all([
  A.page.evaluate(() => state.tiles.map(t => t.code + ":" + t.kind).sort().join("|")),
  B.page.evaluate(() => state.tiles.map(t => t.code + ":" + t.kind).sort().join("|")),
]);
check("deal: both players see the same 18 pairs", tilesA === tilesB && tilesA.split("|").length === 36);
check("deal: phone player is on the portrait layout", await B.page.evaluate(() => state.layout === "portrait"));
await A.page.screenshot({ path: join(SHOTS, "versus-desktop.png") });
await B.page.screenshot({ path: join(SHOTS, "versus-phone.png") });

// --- Alice takes a pair; Bob's board and both scoreboards follow ---
const before = await aliveCount(B.page);
await matchOne(A.page);
await waitFn(B.page, (n) => state.tiles.filter(t => t.alive).length === n - 2, await before);
await waitFn(A.page, () => vs.scores.A === 1);
check("sync: Alice's pair disappears on Bob's phone too", true);
check("score: Alice 1 on her screen, Bob sees Alice at 1", (await A.page.locator("#v-me").textContent()) === "1"
  && (await B.page.locator("#v-opp").textContent()) === "1");

// --- Bob takes a pair from his phone layout; Alice follows ---
await matchOne(B.page);
await waitFn(A.page, () => vs.scores.B === 1 && state.tiles.filter(t => t.alive).length === 32);
check("sync: Bob's pair disappears on Alice's desktop too", true);

// --- Alice misses: local mistake, board unchanged for Bob ---
await A.page.evaluate(() => {
  const f = freeTiles();
  for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++)
    if (f[i].code !== f[j].code) { window.__wrong = [state.tiles.indexOf(f[i]), state.tiles.indexOf(f[j])]; return; }
});
const wrong = await A.page.evaluate(() => window.__wrong);
await click(A.page, wrong[0]);
await click(A.page, wrong[1]);
await A.page.waitForFunction(() => state.mistakes === 1, null, { timeout: 5000 });
check("miss: wrong pair costs Alice a miss and removes nothing", (await aliveCount(A.page)) === 32
  && (await aliveCount(B.page)) === 32);

// --- Alice's browser dies mid-game; she rejoins right where she was ---
await A.page.close();
await waitFn(B.page, () => vs.connected.A === false);
check("reconnect: Bob is told Alice left", (await B.page.locator("#v-status").textContent()).includes("disconnected"));
const A2page = await A.context.newPage();
A2page.on("console", m => { if (m.type() === "error") A.errors.push(`A2 console.error: ${m.text()}`); });
A2page.on("pageerror", e => A.errors.push(`A2 pageerror: ${e.message}`));
await A2page.goto(BASE, { waitUntil: "load" });
await A2page.locator("#tab-versus").click();
await waitFn(A2page, () => vs && vs.status === "playing" && state && state.kind === "versus" && vs.scores.A === 1);
check("reconnect: Alice rejoins with her score and board intact", (await aliveCount(A2page)) === 32);
await waitFn(B.page, () => vs.connected.A === true);
check("reconnect: Bob sees Alice back", true);
A.page = A2page;

// --- race the rest of the board down, alternating players ---
for (let step = 0; step < 200; step++) {
  const done = await A.page.evaluate(() => vs.status === "done");
  if (done) break;
  try {
  const beforeA = await aliveCount(A.page);
  let moved = await matchOne(step % 2 ? B.page : A.page);
  if (!moved) moved = await matchOne(step % 2 ? A.page : B.page);
  if (!moved) {
    await A.page.locator("#btn-shuffle").click();
    await A.page.waitForFunction(n => state.tiles.filter(t => t.alive).length > 0 && !!findMove(), null, { timeout: 8000 });
    await waitFn(B.page, n => state.tiles.filter(t => t.alive).length === n, beforeA);
    continue;
  }
  const other = await aliveCount(step % 2 ? A.page : B.page);
  if (other !== beforeA - 2) {
    await waitFn(step % 2 ? A.page : B.page, n => state.tiles.filter(t => t.alive).length === n, beforeA - 2);
  }
  } catch (e) {
    console.log("DEBUG stall at step", step,
      "A:", JSON.stringify(await A.page.evaluate(() => ({ st: vs.status, alive: state.tiles.filter(t => t.alive).length, sel: state.sel, scores: vs.scores, move: !!findMove() }))),
      "B:", JSON.stringify(await B.page.evaluate(() => ({ st: vs.status, alive: state.tiles.filter(t => t.alive).length, sel: state.sel, scores: vs.scores, move: !!findMove() }))));
    throw e;
  }
}
await waitFn(A.page, () => vs.status === "done");
await waitFn(B.page, () => vs.status === "done");
const [sa, sb] = await Promise.all([A.page.evaluate(() => ({ ...vs.scores, winner: vs.winner })), B.page.evaluate(() => ({ ...vs.scores, winner: vs.winner }))]);
check("end: board fully cleared on both screens", (await aliveCount(A.page)) === 0 && (await aliveCount(B.page)) === 0);
check("end: scores agree and cover all 18 pairs", sa.A === sb.A && sa.B === sb.B && sa.A + sa.B === 18, JSON.stringify(sa));
check("end: winner agrees on both screens", sa.winner === sb.winner && !!sa.winner, sa.winner);
check("end: both players see the result", (await A.page.locator("#v-status").textContent()).match(/win|tie/i) !== null
  && (await B.page.locator("#v-status").textContent()).match(/win|tie/i) !== null);
await A.page.screenshot({ path: join(SHOTS, "versus-end-desktop.png") });
await B.page.screenshot({ path: join(SHOTS, "versus-end-phone.png") });

const errors = [...A.errors, ...B.errors];
check("versus: no console or page errors anywhere", errors.length === 0, errors.join(" | "));

await browser.close();
server.kill();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll versus checks passed");
process.exit(failures ? 1 : 0);
