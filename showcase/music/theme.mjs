// Generates an original marimba-and-kalimba track as a 16-bit stereo WAV, no dependencies.
// Plucked sine voices with decaying harmonics, triangle bass, shaker and woodblock, a light
// dotted-eighth echo. 112 BPM, D major, I-V-vi-IV. Calm and quick, like a tile table.
// Output: showcase/public/music/mahgeong-theme.wav
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../public/music/mahgeong-theme.wav');

const SR = 44100;
const BPM = 112;
const SIXTEENTH = (60 / BPM) / 4;
const LOOPS = 5;                       // 4 bars per loop, about 43 s

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const N = (name) => {
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0);
  return 12 * (Number(m[3]) + 1) + base;
};

// 4 bars: D  A  Bm  G
const CHORDS = [['D4', 'F#4', 'A4'], ['A3', 'C#4', 'E4'], ['B3', 'D4', 'F#4'], ['G3', 'B3', 'D4']];
const BASS = ['D2', 'A2', 'B2', 'G2'];

// Marimba line, [note|null, sixteenths], 64 sixteenths per loop. Pentatonic, unhurried.
const LEAD = [
  ['F#5', 2], ['A5', 2], ['D6', 2], ['A5', 2], ['F#5', 4], ['E5', 2], ['D5', 2],
  ['E5', 2], ['A5', 2], ['C#6', 2], ['A5', 2], ['E6', 4], [null, 2], ['C#6', 2],
  ['D6', 2], ['B5', 2], ['F#5', 2], ['B5', 2], ['D6', 2], ['F#6', 2], ['E6', 4],
  ['D6', 2], ['B5', 2], ['G5', 2], ['B5', 2], ['A5', 6], [null, 2],
];
// Second-time-through answer phrase, so the loop does not feel like a loop.
const LEAD_B = [
  ['A5', 2], ['F#5', 2], ['D5', 2], ['F#5', 2], ['A5', 2], ['D6', 2], ['F#6', 4],
  ['E6', 2], ['C#6', 2], ['A5', 2], ['C#6', 2], ['E6', 6], ['D6', 2],
  ['B5', 2], ['D6', 2], ['F#6', 2], ['D6', 2], ['B5', 2], ['F#5', 2], ['B5', 4],
  ['G5', 2], ['B5', 2], ['D6', 2], ['B5', 2], ['A5', 8],
];

const triangle = (t, f) => 1 - 4 * Math.abs(Math.round(t * f - 0.25) - (t * f - 0.25));
let seed = 0x9e3779b9;
const noise = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };

const totalSixteenths = 64 * LOOPS;
const totalSec = totalSixteenths * SIXTEENTH + 2.5;
const frames = Math.floor(totalSec * SR);
const L = new Float32Array(frames);
const R = new Float32Array(frames);

/** Struck bar: a sine with two quickly decaying upper partials and an exponential tail. */
function pluck({ start, freq, gain, pan = 0, tau = 0.32, bright = 1 }) {
  const s0 = Math.floor(start * SR);
  const n = Math.floor(tau * 6 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const w = 2 * Math.PI * freq * t;
    const atk = Math.min(1, t / 0.003);
    const v = Math.sin(w) * Math.exp(-t / tau)
      + 0.45 * bright * Math.sin(w * 3.98) * Math.exp(-t / (tau * 0.22))
      + 0.18 * bright * Math.sin(w * 9.2) * Math.exp(-t / (tau * 0.08));
    const x = v * atk * gain;
    const idx = s0 + i;
    if (idx >= frames) break;
    L[idx] += x * (1 - Math.max(0, pan));
    R[idx] += x * (1 + Math.min(0, pan));
  }
}
function bass({ start, freq, len, gain }) {
  const s0 = Math.floor(start * SR);
  const n = Math.floor(len * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = Math.min(1, t / 0.01) * (t < len - 0.05 ? 1 : Math.max(0, (len - t) / 0.05)) * Math.exp(-t / 0.9);
    const x = (0.7 * triangle(t, freq) + 0.3 * Math.sin(2 * Math.PI * freq * t)) * e * gain;
    const idx = s0 + i;
    if (idx >= frames) break;
    L[idx] += x; R[idx] += x;
  }
}
function perc(kind, start) {
  const s0 = Math.floor(start * SR);
  const len = kind === 'block' ? 0.09 : kind === 'shaker' ? 0.05 : 0.16;
  const n = Math.floor(len * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let x;
    if (kind === 'block') x = Math.sin(2 * Math.PI * 820 * t) * Math.exp(-t / 0.018) * 0.55;
    else if (kind === 'shaker') x = noise() * Math.pow(1 - t / len, 2.5) * 0.11;
    else x = Math.sin(2 * Math.PI * (70 - 120 * t) * t) * (1 - t / len) * 0.5;
    const idx = s0 + i;
    if (idx >= frames) break;
    L[idx] += x * (kind === 'shaker' ? 0.8 : 1); R[idx] += x * (kind === 'shaker' ? 1.2 : 1);
  }
}

for (let loop = 0; loop < LOOPS; loop++) {
  const base = loop * 64 * SIXTEENTH;
  const line = loop % 2 === 1 ? LEAD_B : LEAD;
  const last = loop === LOOPS - 1;
  let cursor = 0;
  for (const [name, len] of line) {
    if (name && !(loop === 0 && cursor < 16)) {
      const start = base + cursor * SIXTEENTH;
      pluck({ start, freq: midi(N(name)), gain: 0.2, pan: 0.18, tau: len >= 4 ? 0.5 : 0.32 });
      // an octave-down shadow on long notes, like a second mallet
      if (len >= 4) pluck({ start: start + 0.012, freq: midi(N(name) - 12), gain: 0.07, pan: -0.1, tau: 0.5, bright: 0.5 });
    }
    cursor += len;
  }
  for (let bar = 0; bar < 4; bar++) {
    const chord = CHORDS[bar].map(N);
    const arp = [chord[0], chord[2], chord[1], chord[2] + 12, chord[0] + 12, chord[2], chord[1] + 12, chord[2]];
    for (let s = 0; s < 16; s++) {
      const start = base + (bar * 16 + s) * SIXTEENTH;
      // kalimba arpeggio on the off-sixteenths, quiet, panned left
      if (s % 2 === 1 && !last) pluck({ start, freq: midi(arp[((s - 1) / 2) % 8] + 12), gain: 0.05, pan: -0.35, tau: 0.22, bright: 0.7 });
      const b = N(BASS[bar]);
      if (s === 0) bass({ start, freq: midi(b), len: SIXTEENTH * 6, gain: 0.26 });
      if (s === 8) bass({ start, freq: midi(b + (bar === 2 ? 5 : 7)), len: SIXTEENTH * 4, gain: 0.2 });
      if (s === 14) bass({ start, freq: midi(b), len: SIXTEENTH * 2, gain: 0.16 });
      if (loop > 0) {
        if (s === 0 || s === 10) perc('thump', start);
        if (s === 4 || s === 12) perc('block', start);
        if (s % 2 === 0) perc('shaker', start);
        if (s === 14 && bar === 3) perc('block', start);
      }
    }
  }
}

// dotted-eighth echo across the stereo field, then a soft one-pole low-pass, soft clip, fade
function echo(ch, other) {
  const d = Math.floor(SIXTEENTH * 3 * SR);
  for (let i = d; i < ch.length; i++) ch[i] += other[i - d] * 0.22;
}
const L0 = Float32Array.from(L), R0 = Float32Array.from(R);
echo(L, R0); echo(R, L0);
for (const ch of [L, R]) {
  let y = 0;
  for (let i = 0; i < ch.length; i++) { y += 0.55 * (ch[i] - y); ch[i] = Math.tanh(y * 1.3); }
  const fade = Math.floor(2.5 * SR);
  for (let i = 0; i < fade; i++) ch[ch.length - 1 - i] *= i / fade;
}

const bytes = Buffer.alloc(44 + frames * 4);
bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + frames * 4, 4); bytes.write('WAVE', 8);
bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
bytes.writeUInt32LE(SR, 24); bytes.writeUInt32LE(SR * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
bytes.write('data', 36); bytes.writeUInt32LE(frames * 4, 40);
for (let i = 0; i < frames; i++) {
  bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
  bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bytes);
console.log(`wrote ${OUT} (${totalSec.toFixed(1)} s, ${(bytes.length / 1048576).toFixed(1)} MB)`);
