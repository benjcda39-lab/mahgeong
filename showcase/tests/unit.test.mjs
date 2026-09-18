// Unit tests for Mahgeong's rules: tile availability (free-state), selection and matching.
//
//   node --test tests/
//
// Two harnesses, both driven by the real index.html so tests can never drift from the game:
//  1. pure logic (layouts, isFree, dealing) lifted out of the page into a vm sandbox;
//  2. the whole page booted in jsdom, played through real DOM click events.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const GAME = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../index.html");
const html = readFileSync(GAME, "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>\s*$/)[1];
const pure = script.slice(0, script.indexOf("// ---------- state ----------"));

function loadRules() {
  const sandbox = { document: { addEventListener() {} }, window: { innerWidth: 1280 }, localStorage: { getItem: () => null } };
  vm.createContext(sandbox);
  return vm.runInContext(pure + `
;({ DATA, KINDS, LAYOUTS, PORTRAIT, overlaps, isFree, generate, randomDeal, dealOrder,
    pickCountries, capacity, makeTiles, mulberry32, dailySpec, todayNumber,
    seed: r => { rng = r; }, unseed: () => { rng = Math.random; } })`, sandbox);
}
const R = loadRules();

// ---------- free-state (isFree) ----------

test("a lone tile is free", () => {
  const t = { x: 0, y: 0, z: 0 };
  assert.equal(R.isFree(t, [t]), true);
});

test("a tile with another directly on top is blocked; one layer up but not overlapping is fine", () => {
  const t = { x: 0, y: 0, z: 0 };
  assert.equal(R.isFree(t, [t, { x: 0, y: 0, z: 1 }]), false);
  assert.equal(R.isFree(t, [t, { x: 1, y: 1, z: 1 }]), false);          // half-overlap still sits on it
  assert.equal(R.isFree(t, [t, { x: 2, y: 0, z: 1 }]), true);           // beside, not on top
  assert.equal(R.isFree(t, [t, { x: 0, y: 0, z: 2 }]), true);           // two layers up doesn't touch it
  assert.equal(R.isFree(t, [t, { x: 4, y: 4, z: 1 }]), true);           // nowhere near
});

test("one open side is enough; blocked both sides is not free", () => {
  const t = { x: 2, y: 0, z: 0 };
  const left = { x: 0, y: 0, z: 0 }, right = { x: 4, y: 0, z: 0 };
  assert.equal(R.isFree(t, [t, left]), true);            // right side open
  assert.equal(R.isFree(t, [t, right]), true);           // left side open
  assert.equal(R.isFree(t, [t, left, right]), false);    // squeezed
  assert.equal(R.isFree(t, [t, { x: 0, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }]), false); // half-row offsets still squeeze
  assert.equal(R.isFree(t, [t, { x: 0, y: 2, z: 0 }, { x: 4, y: 2, z: 0 }]), true);  // different row entirely
});

test("generate peels every layout in free pairs, so a fair deal is always solvable", () => {
  for (const size of [12, 18, 24, 30]) {
    for (const table of [R.LAYOUTS, R.PORTRAIT]) {
      const order = R.generate(table[size]);
      assert.ok(order, `generate(${size})`);
      assert.equal(order.length * 2, table[size].length);
      // Replay the peel: at each step both tiles must be free of what remains.
      let alive = table[size].slice();
      for (const [a, b] of order) {
        assert.ok(R.isFree(a, alive), "first tile free when peeled");
        assert.ok(R.isFree(b, alive), "second tile free when peeled");
        alive = alive.filter(t => t !== a && t !== b);
      }
      assert.equal(alive.length, 0);
    }
  }
});

test("classic deal pairs every position exactly once", () => {
  const order = R.randomDeal(R.LAYOUTS[18]);
  assert.equal(order.length * 2, R.LAYOUTS[18].length);
  const seen = new Set(order.flat().map(p => `${p.x},${p.y},${p.z}`));
  assert.equal(seen.size, R.LAYOUTS[18].length);
});

// ---------- dealing and pairing ----------

test("makeTiles builds complete country pairs on distinct positions", () => {
  for (const mode of ["capital", "flag", "currency", "population", "mix"]) {
    const tiles = R.makeTiles(mode, 18, "fair");
    assert.equal(tiles.length, 36);
    const byCode = {};
    for (const t of tiles) (byCode[t.code] = byCode[t.code] || []).push(t);
    for (const code of Object.keys(byCode)) {
      const pair = byCode[code];
      assert.equal(pair.length, 2, `${code} appears twice`);
      assert.equal(pair.filter(t => t.kind === "name").length, 1, `${code} has exactly one name tile`);
      if (mode !== "mix") assert.equal(pair.find(t => t.kind !== "name").kind, mode);
    }
    const pos = new Set(tiles.map(t => `${t.x},${t.y},${t.z}`));
    assert.equal(pos.size, 36, "no two tiles share a slot");
  }
});

test("pickCountries never puts the same clue on the board twice", () => {
  for (const mode of ["capital", "flag", "currency", "population", "mix"]) {
    const picks = R.pickCountries(24, mode);
    assert.equal(picks.length, 24);
    const keys = picks.map(p => `${p.kind}:${p.code}`);
    assert.equal(new Set(keys).size, 24);
  }
});

test("the daily spec is deterministic and keeps the epoch stable", () => {
  assert.equal(JSON.stringify(R.dailySpec(9)), JSON.stringify(R.dailySpec(9)));
  assert.equal(JSON.stringify(R.dailySpec(1)), JSON.stringify({ mode: "capital", size: 18 }));
  for (let n = 1; n < 8; n++) assert.notEqual(R.dailySpec(n + 1).mode, R.dailySpec(n).mode, "mode rotates day to day");
});

// ---------- selection and matching in the real page (jsdom) ----------

let dom, win;
const ev = (expr) => win.eval(expr);
const clickTile = (i) => win.document.querySelectorAll("#board .tile")[i]
  .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

before(async () => {
  dom = new JSDOM(html, {
    url: "https://mahgeong.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.localStorage.setItem("mahgeong-help-seen", "1");
    },
  });
  win = dom.window;
  await new Promise(r => win.document.readyState === "complete" ? r() : win.addEventListener("load", r));
  // Deterministic practice board: 18 pairs, world deck, capitals, fair deal.
  ev(`setTab("practice")`);
});

after(() => { ev(`closeOverlay(); stopTimer();`); win.close(); });

test("a fresh board marks every tile free or blocked and offers a move", () => {
  assert.equal(ev(`state.tiles.length`), 36);
  assert.ok(ev(`document.querySelectorAll("#board .tile.free").length`) > 0);
  assert.ok(ev(`document.querySelectorAll("#board .tile.blocked").length`) > 0);
  assert.ok(ev(`!!findMove()`));
  assert.equal(ev(`state.sel`), -1);
});

test("clicking a blocked tile selects nothing and costs nothing", () => {
  const i = ev(`state.tiles.findIndex(t => t.alive && t.el.classList.contains("blocked"))`);
  assert.ok(i >= 0);
  clickTile(i);
  assert.equal(ev(`state.sel`), -1);
  assert.equal(ev(`state.mistakes`), 0);
  assert.equal(ev(`state.tiles.filter(t => t.alive).length`), 36);
});

test("clicking a free tile selects it; clicking it again deselects", () => {
  const i = ev(`state.tiles.findIndex(t => t.el.classList.contains("free"))`);
  clickTile(i);
  assert.equal(ev(`state.sel`), i);
  assert.ok(ev(`state.tiles[${i}].el.classList.contains("selected")`));
  clickTile(i);
  assert.equal(ev(`state.sel`), -1);
});

test("two free tiles of different countries are a miss: both stay, mistakes tick", () => {
  const [a, b] = ev(`(() => {
    const f = freeTiles();
    for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++)
      if (f[i].code !== f[j].code) return [state.tiles.indexOf(f[i]), state.tiles.indexOf(f[j])];
    return null;
  })()`);
  assert.ok(a != null, "two different free tiles exist");
  clickTile(a);
  clickTile(b);
  assert.equal(ev(`state.mistakes`), 1);
  assert.equal(ev(`state.tiles[${a}].alive && state.tiles[${b}].alive`), true);
  assert.equal(ev(`state.sel`), -1);
  assert.equal(ev(`state.tiles.filter(t => t.alive).length`), 36);
});

test("two free tiles of the same country match: both leave the board, the log grows", () => {
  const [a, b] = ev(`findMove().map(t => state.tiles.indexOf(t))`);
  clickTile(a);
  assert.equal(ev(`state.sel`), a, "first tile selected");
  clickTile(b);
  assert.equal(ev(`state.tiles[${a}].alive`), false);
  assert.equal(ev(`state.tiles[${b}].alive`), false);
  assert.ok(ev(`state.tiles[${a}].el.classList.contains("gone")`));
  assert.equal(ev(`state.log.length`), 1);
  assert.equal(ev(`state.mistakes`), 1, "the earlier miss still stands");
  assert.equal(ev(`document.getElementById("st-left").textContent`), "17");
});

test("a hint flags one free matching pair without removing anything", () => {
  win.document.getElementById("btn-hint").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  assert.equal(ev(`state.hints`), 1);
  assert.equal(ev(`state.tiles.filter(t => t.alive).length`), 34);
});

test("shuffle redeals the remaining tiles into a solvable board with pairings intact", () => {
  const before = ev(`JSON.stringify(state.tiles.filter(t=>t.alive).map(t=>t.code+":"+t.kind).sort())`);
  win.document.getElementById("btn-shuffle").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  assert.equal(ev(`state.shuffles`), 1);
  assert.equal(ev(`JSON.stringify(state.tiles.filter(t=>t.alive).map(t=>t.code+":"+t.kind).sort())`), before);
  assert.ok(ev(`!!findMove()`), "a move exists after a fair shuffle");
});

test("the whole board can be cleared pair by pair until the game is done", () => {
  for (let step = 0; step < 100 && !ev(`state.done`); step++) {
    const m = ev(`(findMove() || []).map(t => state.tiles.indexOf(t))`);
    if (!m.length) {
      win.document.getElementById("btn-shuffle").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
      continue;
    }
    clickTile(m[0]);
    clickTile(m[1]);
  }
  assert.equal(ev(`state.done`), true);
  assert.equal(ev(`state.tiles.filter(t => t.alive).length`), 0);
  assert.equal(ev(`document.getElementById("sheet-end").hidden`), false);
  assert.equal(ev(`document.querySelectorAll("#recap li").length`), 18);
});
