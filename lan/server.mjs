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
import { boardKey, validSubmission, submitScore, getScores, schema, seasonNumber, seasonSummary } from "./leaderboard.mjs";

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
  overlaps, isFree, generate, dealOrder, makeTiles, mulberry32,
  seed: r => { rng = r; },
  tiles: (mode, size, deal) => { rng = Math.random; return makeTiles(mode, size, deal); },
  decks: DECKS, capacity,
})`, sandbox);
}
const rules = loadRules();
// The filesystem on Render's free instances is ephemeral. No DB, no leaderboard:
// never show scores as persistent when they would vanish on a restart or deploy.
let scoresDb = null;
const currentSeason = seasonNumber();
if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  scoresDb = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  await scoresDb.query(schema); // fail startup rather than pretend scores are available
}


const BOARD_MODE = "mix", BOARD_SIZE = 18, BOARD_DEAL = "fair";

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
// Only accept same-origin browser requests for writes; this is CSRF hygiene, not
// proof the score is genuine. A script or modified browser can still submit scores.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try { const u = new URL(origin); return ["http:", "https:"].includes(u.protocol) && u.host === req.headers.host; } catch { return false; }
}
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
  };
}

function broadcast(room, obj) {
  for (const s of ["A", "B"]) if (room.seats[s] && room.seats[s].isOpen()) room.seats[s].send(obj);
}

function broadcastState(room) {
  for (const s of ["A", "B"]) if (room.seats[s] && room.seats[s].isOpen()) room.seats[s].send(publicState(room, s));
}

function aliveTiles(room) { return room.tiles.filter(t => t.alive); }
function finishRoom(room) {
  room.status = "done";
  room.winner = room.scores.A === room.scores.B ? "tie" : room.scores.A > room.scores.B ? "A" : "B";
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
      room.status = "playing";
      client.send({ t: "joined", room: room.code, seat: open, token });
      broadcastState(room);
      broadcast(room, { t: "peer", seat: open, connected: true, name });
      return;
    }
    if (m.room) return client.send({ t: "error", msg: "No room with that code on this host." });
    // Create a room and deal a fresh board.
    const code = newCode();
    const token = newToken();
    const tiles = rules.tiles(BOARD_MODE, BOARD_SIZE, BOARD_DEAL).map(({ x, y, z, code: c, kind }) => ({ x, y, z, code: c, kind, alive: true }));
    const room = {
      code, tiles, status: "waiting",
      scores: { A: 0, B: 0 }, misses: { A: 0, B: 0 },
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

  if (m.t === "miss") {                       // a wrong pair, reported for the scoreboard
    room.misses[client.seat]++;
    broadcast(room, { t: "miss", seat: client.seat, misses: room.misses });
    return;
  }

  if (m.t === "match") {
    if (room.status !== "playing") return client.send({ t: "reject" });
    // Each client enforces the free-tile rule against its own layout (phones stack the
    // same pairing differently), so the server validates only what is layout-independent:
    // both tiles alive, distinct, and the same country. First valid claim wins a race.
    const a = room.tiles[m.a], b = room.tiles[m.b];
    const ok = a && b && a !== b && a.alive && b.alive && a.code === b.code;
    if (!ok) { client.send({ t: "reject" }); client.send(publicState(room, client.seat)); return; }
    a.alive = b.alive = false;
    room.scores[client.seat]++;
    broadcast(room, { t: "match", a: m.a, b: m.b, by: client.seat, scores: room.scores, left: aliveTiles(room).length / 2 });
    if (!aliveTiles(room).length) return finishRoom(room);
    return;
  }

  if (m.t === "shuffle") {
    if (room.status !== "playing") return;
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
  let url;
  try { url = decodeURIComponent((req.url || "/").split("?")[0]); }
  catch { res.writeHead(400); return res.end("bad URL"); }
  if (url === "/api/season") {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    if (req.method !== "GET") { res.writeHead(405); return res.end(JSON.stringify({ error: "Method not allowed." })); }
    if (!scoresDb) { res.writeHead(503); return res.end(JSON.stringify({ error: "Season standings are not configured on this host." })); }
    return void seasonSummary(scoresDb, currentSeason)
      .then(data => { res.writeHead(200); res.end(JSON.stringify(data)); })
      .catch(() => { res.writeHead(503); res.end(JSON.stringify({ error: "Season standings are temporarily unavailable." })); });
  }
  if (url === "/api/scores") {
    const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
    if (!scoresDb) return reply(503, { error: "Leaderboard is not configured on this host." });
    if (req.method === "GET") {
      let board;
      try { board = JSON.parse(new URL(req.url, "http://localhost").searchParams.get("board")); } catch { return reply(400, { error: "Invalid board." }); }
      const key = boardKey(board, rules);
      if (!key) return reply(400, { error: "Invalid board." });
      return void getScores(scoresDb, key).then(data => reply(200, data)).catch(() => reply(503, { error: "Leaderboard is temporarily unavailable." }));
    }
    if (req.method === "POST") {
      if (!sameOrigin(req)) return reply(403, { error: "Wrong origin." });
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) return reply(415, { error: "Send JSON." });
      let body = "";
      req.on("data", chunk => { body += chunk; if (body.length > 2048) req.destroy(); });
      req.on("end", () => {
        let data;
        try { data = JSON.parse(body); } catch { return reply(400, { error: "Invalid score." }); }
        if (!validSubmission(data, rules)) return reply(400, { error: "Invalid score." });
        submitScore(scoresDb, data, rules).then(result => reply(200, result)).catch(() => reply(503, { error: "Leaderboard is temporarily unavailable." }));
      });
      return;
    }
    return reply(405, { error: "Method not allowed." });
  }
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
