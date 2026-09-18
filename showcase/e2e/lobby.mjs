// End-to-end check for the one-off versus lobby: join, Ready on both sides, and the
// locked board before the game starts.
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

const A = await newPlayer("Alice", { w: 1280, h: 800 });
const B = await newPlayer("Bob", { w: 390, h: 844, mobile: true });

// --- hosting opens the room; no Ready until player two joins ---
await A.page.locator("#v-name").fill("Alice");
await A.page.locator("#v-create").click();
await waitFn(A.page, () => vs && vs.room && vs.status === "waiting");
const code = await A.page.evaluate(() => vs.room);
check("lobby: room created with a 4-letter code", /^[A-Z]{4}$/.test(code), code);
check("lobby: waiting-room overlay is up", await A.page.locator("#v-lobby").isVisible());
check("lobby: no Ready before player two joins", await A.page.locator("#v-ready").isHidden());

// --- bad room code is rejected cleanly ---
await B.page.locator("#v-name").fill("Bob");
await B.page.locator("#v-code").fill("ZZZZ");
await B.page.locator("#v-join").click();
await B.page.waitForFunction(() => document.getElementById("v-status").textContent.includes("No room"), null, { timeout: 10000 });
check("lobby: a bad room code is rejected cleanly", true);

// --- join: Ready appears on both screens ---
await B.page.locator("#v-code").fill(code);
await B.page.locator("#v-join").click();
await waitFn(B.page, () => vs && vs.status === "waiting" && vs.names && vs.names.A === "Alice");
await waitFn(A.page, () => vs.names && vs.names.B === "Bob");
check("lobby: Ready is offered once both players are in", await A.page.locator("#v-ready").isVisible()
  && await B.page.locator("#v-ready").isVisible());

// --- no gameplay before the start: a raw select is rejected ---
await A.page.evaluate(() => vs.ws.send(JSON.stringify({ t: "select", i: 0 })));
await A.page.waitForTimeout(400);
check("lobby: no gameplay before both are ready", (await A.page.evaluate(() => !vs.pending))
  && (await B.page.evaluate(() => !vs.pending)));

// --- one ready keeps the room waiting; a duplicate ready changes nothing ---
await A.page.locator("#v-ready").click();
await waitFn(A.page, () => vs.ready.A && vs.status === "waiting");
await waitFn(B.page, () => vs.ready.A && vs.status === "waiting");
check("lobby: one ready keeps the room waiting on both screens", true);
check("lobby: the ready button reflects the lock", await A.page.locator("#v-ready").isDisabled());
await A.page.locator("#v-ready").click({ force: true });
await A.page.waitForTimeout(400);
check("lobby: duplicate ready changes nothing", (await A.page.evaluate(() => vs.status)) === "waiting"
  && (await B.page.evaluate(() => vs.status)) === "waiting");
await A.page.screenshot({ path: join(SHOTS, "lobby-desktop.png") });
await B.page.screenshot({ path: join(SHOTS, "lobby-phone.png") });

// --- reconnect in the lobby: Bob leaves and rejoins with the room intact ---
await B.page.close();
await waitFn(A.page, () => vs.connected.B === false);
const B2page = await B.context.newPage();
B2page.on("console", m => { if (m.type() === "error") B.errors.push(`B2 console.error: ${m.text()}`); });
B2page.on("pageerror", e => B.errors.push(`B2 pageerror: ${e.message}`));
await B2page.goto(BASE, { waitUntil: "load" });
await B2page.locator("#tab-versus").click();
await waitFn(B2page, () => vs && vs.status === "waiting" && vs.ready.A === true && vs.names.A === "Alice");
check("lobby: rejoin restores the waiting room", true);
B.page = B2page;

// --- both ready: synchronized start on desktop and phone ---
await B.page.locator("#v-ready").click();
await waitFn(A.page, () => vs.status === "playing");
await waitFn(B.page, () => vs.status === "playing" && state && state.kind === "versus" && state.tiles.length === 36);
check("lobby: both ready starts the game on both screens", true);
check("lobby: the overlay lifts on start", await A.page.locator("#v-lobby").isHidden()
  && await B.page.locator("#v-lobby").isHidden());
check("lobby: Alice holds the first turn", (await A.page.evaluate(() => vs.turn)) === "A");
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
