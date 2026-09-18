// End-to-end check for the death-match lobby: join, the alternating veto draft, Ready,
// and the locked board before round 1.
//
//   node e2e/lobby.mjs [base-url]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const SERVER = resolve(here, "../../lan/server.mjs");
const SHOTS = resolve(here, "../out/verify");
const PORT = 8644;
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

const waitFn = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000 });
const veto = (page, cat) => page.locator(`[data-cat="${cat}"]`).click({ force: true });
const rawVeto = (page, cat) => page.evaluate(c => vs.ws.send(JSON.stringify({ t: "veto", cat: c })), cat);

const A = await newPlayer("Alice", { w: 1280, h: 800 });
const B = await newPlayer("Bob", { w: 390, h: 844, mobile: true });

// --- hosting opens the room; no draft and no Ready until player two joins ---
await A.page.locator("#v-name").fill("Alice");
await A.page.locator("#v-create").click();
await waitFn(A.page, () => vs && vs.room && vs.status === "waiting" && vs.phase === "veto");
const code = await A.page.evaluate(() => vs.room);
check("lobby: room created with a 4-letter code", /^[A-Z]{4}$/.test(code), code);
check("lobby: waiting-room overlay is up", await A.page.locator("#v-lobby").isVisible());
check("lobby: no Ready and no draft before player two", await A.page.locator("#v-ready").isHidden()
  && (await A.page.locator("#v-cats .chip:enabled").count()) === 0);
await rawVeto(A.page, "flags");
await A.page.waitForTimeout(400);
check("lobby: a solo veto is rejected by the server", (await A.page.evaluate(() => vs.vetoes.length)) === 0);

// --- bad room code is still rejected cleanly ---
await B.page.locator("#v-name").fill("Bob");
await B.page.locator("#v-code").fill("ZZZZ");
await B.page.locator("#v-join").click();
await B.page.waitForFunction(() => document.getElementById("v-status").textContent.includes("No room"), null, { timeout: 10000 });
check("lobby: a bad room code is rejected cleanly", true);

// --- join: the draft opens on both screens ---
await B.page.locator("#v-code").fill(code);
await B.page.locator("#v-join").click();
await waitFn(B.page, () => vs && vs.status === "waiting" && vs.phase === "veto" && vs.names.A === "Alice");
await waitFn(A.page, () => vs.names.B === "Bob");
check("lobby: both players see seven categories", (await A.page.locator("#v-cats .chip").count()) === 7
  && (await B.page.locator("#v-cats .chip").count()) === 7);
check("lobby: Alice holds the first veto", (await A.page.evaluate(() => vs.vetoTurn)) === "A"
  && (await A.page.locator("#v-lobby-note").textContent()).includes("Your veto")
  && (await B.page.locator("#v-lobby-note").textContent()).includes("Waiting for Alice"));

// --- out-of-turn veto: client disables, server rejects ---
check("lobby: Bob's chips are disabled on Alice's veto", (await B.page.locator("#v-cats .chip:enabled").count()) === 0);
await rawVeto(B.page, "flags");
await B.page.waitForTimeout(400);
check("lobby: out-of-turn veto is rejected by the server", (await B.page.evaluate(() => vs.vetoes.length)) === 0);

// --- the draft alternates; duplicates are rejected ---
await veto(A.page, "populations");
await waitFn(B.page, () => vs.vetoes.length === 1 && vs.vetoTurn === "B");
check("lobby: veto alternates to Bob on both screens", (await A.page.evaluate(() => vs.vetoTurn)) === "B");
await rawVeto(B.page, "populations");
await B.page.waitForTimeout(400);
check("lobby: duplicate veto is rejected by the server", (await B.page.evaluate(() => vs.vetoes.length)) === 1
  && (await B.page.evaluate(() => vs.categories.length)) === 6);

// --- reconnect mid-draft: Bob leaves and rejoins with the draft intact ---
await B.page.close();
await waitFn(A.page, () => vs.connected.B === false);
const B2page = await B.context.newPage();
B2page.on("console", m => { if (m.type() === "error") B.errors.push(`B2 console.error: ${m.text()}`); });
B2page.on("pageerror", e => B.errors.push(`B2 pageerror: ${e.message}`));
await B2page.goto(BASE, { waitUntil: "load" });
await B2page.locator("#tab-versus").click();
await waitFn(B2page, () => vs && vs.status === "waiting" && vs.phase === "veto" && vs.vetoes.length === 1 && vs.categories.length === 6);
check("lobby: rejoin restores the draft mid-veto", true);
B.page = B2page;

// --- finish the draft: exactly three categories remain ---
await veto(B.page, "currencies");
await waitFn(A.page, () => vs.vetoes.length === 2 && vs.vetoTurn === "A");
await veto(A.page, "presidents");
await waitFn(B.page, () => vs.vetoes.length === 3 && vs.vetoTurn === "B");
await veto(B.page, "state-flags");
await waitFn(A.page, () => vs.phase === "ready");
await waitFn(B.page, () => vs.phase === "ready");
const [catsA, catsB] = await Promise.all([A.page.evaluate(() => [...vs.categories]), B.page.evaluate(() => [...vs.categories])]);
check("lobby: exactly three categories remain on both screens",
  catsA.length === 3 && catsB.join() === catsA.join() && catsA.join() === "capitals,flags,state-capitals", catsA.join());
check("lobby: Ready is offered once the draft is done", await A.page.locator("#v-ready").isVisible()
  && await B.page.locator("#v-ready").isVisible());
check("lobby: no gameplay before round 1", (await A.page.evaluate(() => vs.scores.A + vs.scores.B)) === 0
  && (await A.page.evaluate(() => !vs.pending)));
await A.page.screenshot({ path: join(SHOTS, "lobby-desktop.png") });
await B.page.screenshot({ path: join(SHOTS, "lobby-phone.png") });

// --- one ready, duplicate ready, then both ready: synchronized round 1 start ---
await A.page.locator("#v-ready").click();
await waitFn(A.page, () => vs.ready.A && vs.status === "waiting");
await waitFn(B.page, () => vs.ready.A && vs.status === "waiting");
check("lobby: one ready keeps the room waiting on both screens", true);
await A.page.locator("#v-ready").click({ force: true });
await A.page.waitForTimeout(400);
check("lobby: duplicate ready changes nothing", (await A.page.evaluate(() => vs.status)) === "waiting"
  && (await B.page.evaluate(() => vs.status)) === "waiting");
await B.page.locator("#v-ready").click();
await waitFn(A.page, () => vs.status === "playing" && vs.round === 1);
await waitFn(B.page, () => vs.status === "playing" && vs.round === 1 && state && state.kind === "versus" && state.tiles.length === 36);
check("lobby: both ready starts round 1 on both screens", true);
check("lobby: round 1 uses the first surviving category", (await A.page.evaluate(() => vs.rounds[0])) === "capitals");
check("lobby: the overlay lifts on start", await A.page.locator("#v-lobby").isHidden()
  && await B.page.locator("#v-lobby").isHidden());
await A.page.evaluate(() => { const mv = findMove(); window.__mv = mv.map(t => state.tiles.indexOf(t)); });
const mv = await A.page.evaluate(() => window.__mv);
await A.page.locator("#board .tile").nth(mv[0]).click({ force: true });
await waitFn(A.page, () => !!vs.pending);
check("lobby: the board accepts play once started", true);

const errors = [...A.errors, ...B.errors];
check("lobby: no console or page errors anywhere", errors.length === 0, errors.join(" | "));

await browser.close();
if (server) server.kill();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll lobby checks passed");
process.exit(failures ? 1 : 0);
