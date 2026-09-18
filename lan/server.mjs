// Mahgeong LAN two-player server.
//
//   node lan/server.mjs [port]        (default port 8642)
//
// Serves the game to every device on the same Wi-Fi/LAN and runs WebSocket rooms for
// two-player versus: one device hosts, the other opens the printed address, and no
// internet connection is needed for play (flag images fall back to emoji offline).
//
// The server is authoritative: it deals the board, validates that a claimed pair is two
// free tiles of the same country, keeps score, and resyncs a player who reconnects.
// The game's own rules are loaded straight out of index.html so server and client can
// never drift apart.

import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import vm from "node:vm";

const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(here, "..");
const PORT = +(process.argv[2] || 8642);

// ---------- game rules, lifted from index.html ----------
function loadRules() {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>\s*$/)[1];
  const pure = script.slice(0, script.indexOf("// ---------- state ----------"));
  const sandbox = { document: { addEventListener() {} }, window: { innerWidth: 1280 }, localStorage: { getItem: () => null } };
  vm.createContext(sandbox);
  return vm.runInContext(pure + `
;({
  overlaps, isFree, generate, dealOrder, makeTiles, mulberry32, DECKS, valueOf,
  seed: r => { rng = r; },
  tiles: (mode, size, deal) => { rng = Math.random; return makeTiles(mode, size, deal); },
})`, sandbox);
}
const rules = loadRules();

const BOARD_SIZE = 18, BOARD_DEAL = "fair";

// The best-of-three death match: seven categories enter the lobby draft, players alternate
// vetoes (two each), and the three survivors become rounds 1-3. First to two rounds wins.
const CATEGORIES = [
  { id: "capitals", label: "Capitals", deck: "world", kind: "capital" },
  { id: "flags", label: "Flags", deck: "world", kind: "flag" },
  { id: "currencies", label: "Currencies", deck: "world", kind: "currency" },
  { id: "populations", label: "Populations", deck: "world", kind: "population" },
  { id: "presidents", label: "US presidents", deck: "presidents", kind: "years" },
  { id: "state-flags", label: "US state flags", deck: "states", kind: "flag" },
  { id: "state-capitals", label: "US state capitals", deck: "states", kind: "capital" },
];
const catOf = id => CATEGORIES.find(c => c.id === id);

// ---------- tiny WebSocket layer (RFC 6455, text frames) ----------
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKey(key) {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

function encodeFrame(op, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

// Parses a socket stream into WebSocket messages. Calls onText(str), onClose().
function attachSocket(socket, onText, onClose) {
  let buf = Buffer.alloc(0), frags = null, closed = false;
  const send = (obj) => { if (!closed && !socket.destroyed) socket.write(encodeFrame(1, Buffer.from(JSON.stringify(obj)))); };
  const close = () => {
    if (closed) return;
    closed = true;
    try { socket.write(encodeFrame(8, Buffer.alloc(0))); } catch {}
    socket.destroy();
    onClose();
  };
  socket.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f;
      const masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = buf.subarray(off, off + len);
      if (masked) {
        const mask = buf.subarray(maskOff, maskOff + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.subarray(off + len);
      if (op === 8) { close(); return; }
      if (op === 9) { try { socket.write(encodeFrame(10, payload)); } catch {} continue; }
      if (op === 10) continue;
      if (op === 0 && frags) { frags.push(payload); if (fin) { const whole = Buffer.concat(frags); frags = null; onText(whole.toString("utf8")); } continue; }
      if ((op === 1 || op === 2) && !fin) { frags = [payload]; continue; }
      if (op === 1) onText(payload.toString("utf8"));
    }
  });
  socket.on("error", close);
  socket.on("close", () => { if (!closed) { closed = true; onClose(); } });
  return { send, close, isOpen: () => !closed && !socket.destroyed };
}

// ---------- rooms ----------
const rooms = new Map();           // code -> room
const ROOM_RE = /^[A-Z]{4}$/;
const newCode = () => {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ";
  let c;
  do { c = [...randomBytes(4)].map(b => abc[b % abc.length]).join(""); } while (rooms.has(c));
  return c;
};
const newToken = () => randomBytes(9).toString("base64url");

function publicState(room, seat) {
  return {
    t: "state",
    room: room.code,
    you: seat,
    status: room.status,                       // waiting | playing | done
    tiles: room.tiles.map(({ x, y, z, code, kind, alive }) => ({ x, y, z, code, kind, alive })),
    scores: room.scores,
    misses: room.misses,
    names: room.names,
    connected: room.connected,
    winner: room.winner,
    ready: room.ready,
    turn: room.turn,
    pending: room.pending,
    phase: room.phase,
    categories: room.categories,
    vetoes: room.vetoes,
    vetoTurn: room.vetoTurn,
    rounds: room.rounds,
    round: room.round,
    roundWins: room.roundWins,
    lastRoundWinner: room.lastRoundWinner,
    champion: room.champion,
    tb: !!room.tb,
    deck: room.deck,
    sdwin: !!room.sdWin,
  };
}

function broadcast(room, obj) {
  for (const s of ["A", "B"]) if (room.seats[s] && room.seats[s].isOpen()) room.seats[s].send(obj);
}

function broadcastState(room) {
  for (const s of ["A", "B"]) if (room.seats[s] && room.seats[s].isOpen()) room.seats[s].send(publicState(room, s));
}

function aliveTiles(room) { return room.tiles.filter(t => t.alive); }
function passTurn(room) { room.turn = room.turn === "A" ? "B" : "A"; }

// Deal a fresh 18-pair board from the round's category and open play.
function startRound(room, n) {
  const cat = catOf(room.rounds[n - 1]);
  const d = rules.DECKS[cat.deck];
  rules.seed(Math.random);
  room.tiles = rules.makeTiles(cat.kind, BOARD_SIZE, BOARD_DEAL, d.pool("all"), d.kinds)
    .map(({ x, y, z, code: c, kind }) => ({ x, y, z, code: c, kind, alive: true }));
  room.deck = cat.deck;
  room.round = n;
  room.scores = { A: 0, B: 0 };
  room.misses = { A: 0, B: 0 };
  room.turn = n % 2 === 1 ? "A" : "B";
  room.pending = null;
  room.tb = null;
  room.sdWin = false;
  room.status = "playing";
  room.phase = "round";
  room.touched = Date.now();
  broadcastState(room);
}

// A round always produces a round winner; two round wins crown the champion. Otherwise the
// lobby reopens for the next round.
function endRound(room, winner, sd) {
  room.roundWins[winner]++;
  room.lastRoundWinner = winner;
  room.winner = winner;
  room.sdWin = sd;
  if (room.roundWins[winner] >= 2) {
    room.status = "done";
    room.phase = "done";
    room.champion = winner;
    broadcastState(room);
    return;
  }
  room.status = "waiting";
  room.phase = "between";
  room.ready = { A: false, B: false };
  room.pending = null;
  room.tb = null;
  broadcastState(room);
}

// Regulation ends in a win, or in sudden death when the board clears level.
function finishBoard(room) {
  if (room.scores.A === room.scores.B) {
    room.tb = { last: { A: null, B: null } };
    sdRound(room);
    broadcastState(room);
    return;
  }
  endRound(room, room.scores.A > room.scores.B ? "A" : "B", false);
}

// Sudden death: one fresh four-tile board per attempt - a country/state/president tile
// plus three same-kind candidates, exactly one of which pairs with it. Content comes
// from the game's other decks and modes, never from the cleared board.
function sdRound(room) {
  const cat = catOf(room.rounds[room.round - 1]);
  const d = rules.DECKS[cat.deck];
  const pool = d.pool("all");
  const kind = cat.kind;
  const entry = pool[Math.floor(Math.random() * pool.length)];
  const distractors = [];
  let guard = 0;
  while (distractors.length < 2 && guard++ < 500) {
    const c = pool[Math.floor(Math.random() * pool.length)];
    if (c[0] === entry[0] || distractors.some(x => x[0] === c[0])) continue;
    if (rules.valueOf(c, kind) === rules.valueOf(entry, kind)) continue;   // no look-alike answers
    distractors.push(c);
  }
  const spots = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 }];
  const raw = [
    { code: entry[0], kind: "name" }, { code: entry[0], kind },
    { code: distractors[0][0], kind }, { code: distractors[1][0], kind },
  ];
  for (let i = raw.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [raw[i], raw[j]] = [raw[j], raw[i]]; }
  room.deck = cat.deck;
  room.tiles = raw.map((t, i) => ({ ...spots[i], z: 0, code: t.code, kind: t.kind, alive: true }));
}

// One sudden-death attempt: a correct pair right after the rival's miss wins the match.
// Anything else passes the turn and deals the next player a fresh board.
function sdAttempt(room, seat, hit) {
  const other = seat === "A" ? "B" : "A";
  if (hit && room.tb.last[other] === "miss") return endRound(room, seat, true);
  room.tb.last[seat] = hit ? "hit" : "miss";
  passTurn(room);
  sdRound(room);
  broadcastState(room);
}

// A failed resolution - wrong second tile, an invalid/blocked claim, or locking a tile with
// no free match - costs the active player a point, hands that point to the opponent, and
// passes the turn. In sudden death a failed attempt is simply a miss: the turn passes.
function penalize(room, seat, reason) {
  room.misses[seat]++;
  if (room.tb) { broadcast(room, { t: "miss", seat, misses: room.misses }); return sdAttempt(room, seat, false); }
  const other = seat === "A" ? "B" : "A";
  room.scores[seat]--;
  room.scores[other]++;
  broadcast(room, { t: "penalty", seat, reason, scores: room.scores, misses: room.misses });
  passTurn(room);
  broadcastState(room);
}

function handleMessage(client, msg) {
  let m;
  try { m = JSON.parse(msg); } catch { return client.send({ t: "error", msg: "bad message" }); }

  if (m.t === "hello") {
    const name = String(m.name || "").trim().slice(0, 24) || (m.room ? "Guest" : "Host");
    // Reconnect: room + a token that matches a seat.
    if (m.room && rooms.has(String(m.room).toUpperCase())) {
      const room = rooms.get(String(m.room).toUpperCase());
      const seat = m.token && room.tokens[m.token];
      if (seat) {
        client.seat = seat; client.room = room;
        room.seats[seat] = client; room.tokens[m.token] = seat;
        room.connected[seat] = true;
        client.send({ t: "joined", room: room.code, seat, token: m.token });
        client.send(publicState(room, seat));
        broadcast(room, { t: "peer", seat, connected: true, name: room.names[seat] });
        return;
      }
      // Fresh join into the open seat.
      const open = !room.seats.A ? "A" : !room.seats.B ? "B" : null;
      if (!open || room.status === "done") return client.send({ t: "error", msg: "That room is full." });
      const token = newToken();
      client.seat = open; client.room = room;
      room.seats[open] = client; room.tokens[token] = open;
      room.names[open] = name; room.connected[open] = true;
      client.send({ t: "joined", room: room.code, seat: open, token });
      broadcastState(room);
      broadcast(room, { t: "peer", seat: open, connected: true, name });
      return;
    }
    if (m.room) return client.send({ t: "error", msg: "No room with that code on this host." });
    // Create a room; the veto draft starts as soon as player two joins.
    const code = newCode();
    const token = newToken();
    const room = {
      code, tiles: [], status: "waiting",
      phase: "veto",
      categories: CATEGORIES.map(c => c.id),
      vetoes: [], vetoTurn: "A",
      rounds: [], round: 0, roundWins: { A: 0, B: 0 }, lastRoundWinner: null, champion: null,
      scores: { A: 0, B: 0 }, misses: { A: 0, B: 0 },
      ready: { A: false, B: false }, turn: "A", tb: null, deck: "world", sdWin: false, pending: null,
      names: { A: name, B: "" }, connected: { A: true, B: false },
      seats: { A: client, B: null }, tokens: { [token]: "A" },
      winner: null, touched: Date.now(),
    };
    rooms.set(code, room);
    client.seat = "A"; client.room = room;
    client.send({ t: "joined", room: code, seat: "A", token });
    client.send(publicState(room, "A"));
    return;
  }

  const room = client.room;
  if (!room || !client.seat) return client.send({ t: "error", msg: "Join a room first." });
  room.touched = Date.now();

  // The veto draft: alternate striking one category, two vetoes each, until three remain.
  if (m.t === "veto") {
    if (room.status !== "waiting" || room.phase !== "veto") return client.send({ t: "reject" });
    if (!room.seats.A || !room.seats.B) return client.send({ t: "reject" });   // wait for player two
    if (client.seat !== room.vetoTurn) return client.send({ t: "reject" });    // not your veto
    const cat = String(m.cat || "");
    if (!room.categories.includes(cat)) return client.send({ t: "reject" });   // unknown or already struck
    room.categories = room.categories.filter(c => c !== cat);
    room.vetoes.push({ seat: client.seat, cat });
    if (room.vetoes.length >= 4) {
      room.phase = "ready";
      room.rounds = room.categories.slice();               // exactly three survive
    } else {
      room.vetoTurn = room.vetoTurn === "A" ? "B" : "A";
    }
    broadcastState(room);
    return;
  }

  // Ready opens the next round (round 1 after the draft, rounds 2-3 after a "between" pause).
  if (m.t === "ready") {
    if (room.status !== "waiting" || (room.phase !== "ready" && room.phase !== "between")) return;
    room.ready[client.seat] = true;                        // tapping Ready twice changes nothing
    if (room.ready.A && room.ready.B) {
      room.ready = { A: false, B: false };
      startRound(room, room.round + 1);
      return;
    }
    broadcastState(room);
    return;
  }

  // First tap of a turn: commit to one free tile. The lock is server-side room state, so
  // neither a refresh nor a reconnect can escape it. "dead" is the active client's report
  // that the locked tile has no free match on its own layout (free-tile rules are
  // layout-dependent, so only the active device can judge them) - a dead lock is a failed
  // attempt and is penalized at once.
  if (m.t === "select") {
    if (room.status !== "playing" || client.seat !== room.turn) return client.send({ t: "reject" });
    if (room.pending) return client.send({ t: "reject" });                  // already committed
    const t = room.tiles[m.i];
    if (!t || !t.alive) return client.send({ t: "reject" });
    if (m.dead) return penalize(room, client.seat, "dead");
    room.pending = { seat: client.seat, tile: m.i };
    broadcastState(room);
    return;
  }

  // Second tap: it must resolve the locked tile. A correct pair scores and keeps the turn;
  // anything else - a wrong tile, a claim that dodges the locked tile, dead tiles - is a
  // failed resolution and is penalized.
  if (m.t === "match") {
    if (room.status !== "playing" || client.seat !== room.turn) return client.send({ t: "reject" });
    if (!room.pending || room.pending.seat !== client.seat) return client.send({ t: "reject" });
    const a = room.tiles[m.a], b = room.tiles[m.b];
    const usesLock = m.a === room.pending.tile || m.b === room.pending.tile;
    const ok = usesLock && a && b && a !== b && a.alive && b.alive && a.code === b.code;
    room.pending = null;
    if (!ok) { client.send({ t: "reject" }); return penalize(room, client.seat, "wrong"); }
    a.alive = b.alive = false;
    if (room.tb) return sdAttempt(room, client.seat, true);
    room.scores[client.seat]++;
    broadcast(room, { t: "match", a: m.a, b: m.b, by: client.seat, scores: room.scores, left: aliveTiles(room).length / 2, turn: room.turn });
    if (!aliveTiles(room).length) return finishBoard(room);
    return;
  }

  // The active client reports a wrong second tile.
  if (m.t === "miss") {
    if (room.status !== "playing" || client.seat !== room.turn || !room.pending) return;
    room.pending = null;
    penalize(room, client.seat, "wrong");
    return;
  }

  if (m.t === "shuffle") {
    if (room.status !== "playing" || room.tb || client.seat !== room.turn) return;
    const alive = aliveTiles(room);
    if (alive.length < 4) return;
    const order = rules.dealOrder(alive.map(t => ({ x: t.x, y: t.y, z: t.z })), "fair");
    if (!order) return broadcast(room, { t: "stuck" });
    const byCode = {};
    alive.forEach(t => (byCode[t.code] = byCode[t.code] || []).push(t));
    const groups = Object.values(byCode);
    for (let i = groups.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [groups[i], groups[j]] = [groups[j], groups[i]]; }
    order.forEach(([p, q], i) => {
      let [u, v] = groups[i];
      if (Math.random() < .5) [u, v] = [v, u];
      Object.assign(u, p); Object.assign(v, q);
    });
    broadcastState(room);
    return;
  }

  client.send({ t: "error", msg: "unknown message" });
}

// ---------- HTTP: the game plus its flags ----------
const MIME = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".mjs": "text/javascript" };
const HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Mahgeong: a daily geography puzzle played like mahjong solitaire.">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 14px system-ui, sans-serif; background: #faf9f6; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
`;
const page = () => HEAD + readFileSync(join(ROOT, "index.html"), "utf8") + "\n</body>\n</html>\n";

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url === "/") { res.writeHead(200, { "content-type": MIME[".html"] }); return res.end(page()); }
  if (url === "/favicon.ico") { res.writeHead(204); return res.end(); }
  if (url === "/health") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size })); }
  const file = normalize(join(ROOT, url));
  if (file.startsWith(ROOT) && existsSync(file) && statSync(file).isFile() && MIME[extname(file)]) {
    res.writeHead(200, { "content-type": MIME[extname(file)] });
    return res.end(readFileSync(file));
  }
  res.writeHead(404); res.end("not found");
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key || (req.url || "").split("?")[0] !== "/ws") { socket.destroy(); return; }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  socket.setNoDelay(true);
  const client = { seat: null, room: null };
  const io = attachSocket(socket, msg => handleMessage(client, msg), () => {
    if (client.room && client.seat) {
      const room = client.room;
      if (room.seats[client.seat] === client) room.seats[client.seat] = null;
      room.connected[client.seat] = false;
      room.touched = Date.now();
      if (room.status !== "done") broadcast(room, { t: "peer", seat: client.seat, connected: false, name: room.names[client.seat] });
    }
  });
  client.send = io.send; client.isOpen = io.isOpen;
});

// Reap rooms nobody has touched for a while.
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [code, room] of rooms) if (room.touched < cutoff) rooms.delete(code);
}, 60 * 1000).unref();

server.listen(PORT, "0.0.0.0", () => {
  const addrs = Object.values(networkInterfaces()).flat().filter(a => a && a.family === "IPv4" && !a.internal).map(a => a.address);
  console.log(`Mahgeong two-player server on port ${PORT}`);
  console.log(`This device:   http://localhost:${PORT}`);
  for (const a of addrs) console.log(`On your Wi-Fi: http://${a}:${PORT}`);
  console.log("Both players open one of these addresses, tap the 2 Player tab, and share the room code.");
});
