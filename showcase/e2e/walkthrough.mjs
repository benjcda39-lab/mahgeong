// Walkthrough recorder: serves the game (wrapped in the same skeleton the artifact host
// uses), drives it in real Chrome once per profile, records each session to MP4, takes a
// screenshot at every step, and writes remotion/manifest.generated.ts for the promo.
//
//   node e2e/walkthrough.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { MANIFEST_META, PROFILES, STEPS } from './steps.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(here, '../../index.html');
const PUB = resolve(here, '../public');
const SHOTS = join(PUB, 'shots');
const CLIPS = join(PUB, 'clips');
const OUT = resolve(here, '../out');
const PORT = 5179;

// The artifact host wraps the page in this skeleton; serve it the same way so the recording
// matches what people actually see.
const HEAD = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';

function serve() {
  const html = HEAD + readFileSync(GAME, 'utf8') + '</body></html>';
  const srv = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  return new Promise((r) => srv.listen(PORT, () => r(srv)));
}

function run(cmd, cmdArgs) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, cmdArgs, { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
  });
}

async function record(browser, profile, url) {
  const vw = Math.round(profile.w * profile.dsf), vh = Math.round(profile.h * profile.dsf);
  const context = await browser.newContext({
    viewport: { width: profile.w, height: profile.h },
    deviceScaleFactor: profile.dsf,
    reducedMotion: 'no-preference',
    colorScheme: 'light',
    // Playwright's screencast is CSS-pixel sized; asking for more just pads the frame with grey.
    recordVideo: { dir: CLIPS, size: { width: profile.w, height: profile.h } },
  });
  const page = await context.newPage();
  // Screenshots are device-pixel sized (crisp); the clip is CSS-pixel sized.
  const clipW = profile.w, clipH = profile.h;
  const log = [];
  page.on('console', (m) => { if (m.type() === 'error') log.push(`[${profile.name} console.error] ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`[${profile.name} pageerror] ${e.message}`));

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.addStyleTag({ content: '::-webkit-scrollbar{width:0;height:0} html{scrollbar-width:none}' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);

  const results = [];
  const media = {};
  for (const step of STEPS) {
    const at = (Date.now() - t0) / 1000;
    let ok = true, error = '';
    try { await step.run(page); } catch (e) { ok = false; error = String(e && e.message ? e.message : e); }
    await page.waitForTimeout(step.settleMs ?? 600);
    const file = `${String(results.length + 1).padStart(2, '0')}-${step.id}-${profile.name}.png`;
    await page.screenshot({ path: join(SHOTS, file), fullPage: false });
    results.push({ id: step.id, ok, error, at, shot: file });
    console.log(`${ok ? 'ok ' : 'ERR'} ${profile.name} ${step.id}${error ? ' - ' + error : ''}`);
    if (step.feature) {
      media[step.id] = step.feature.clip
        ? { kind: 'video', src: `clips/${profile.name}.mp4`, startSec: Math.max(0, at - 0.2), w: clipW, h: clipH }
        : { kind: 'image', src: `shots/${file}`, w: vw, h: vh };
    }
    if (step.holdMs) await page.waitForTimeout(step.holdMs);
  }

  const video = page.video();
  await context.close();
  const webm = await video.path();
  const mp4 = join(CLIPS, `${profile.name}.mp4`);
  await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', webm, '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  try { unlinkSync(webm); } catch {}
  return { results, media, log };
}

async function main() {
  for (const d of [SHOTS, CLIPS, OUT]) mkdirSync(d, { recursive: true });
  for (const d of [SHOTS, CLIPS]) for (const f of readdirSync(d)) { try { unlinkSync(join(d, f)); } catch {} }

  const server = await serve();
  const url = `http://localhost:${PORT}/`;
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1400,1000'] });

  const runs = {};
  for (const profile of PROFILES) runs[profile.name] = await record(browser, profile, url);
  await browser.close();
  server.close();

  const features = STEPS.filter((s) => s.feature).sort((a, b) => a.feature.order - b.feature.order).map((s) => ({
    id: s.id,
    kind: s.feature.kind,
    title: s.feature.title,
    blurb: s.feature.blurb,
    media: { desktop: runs.desktop.media[s.id], phone: runs.phone.media[s.id] },
  }));
  const manifest = `// Generated by e2e/walkthrough.mjs on ${new Date().toISOString()}. Do not edit by hand.
import type { Manifest } from './manifest';

export const MANIFEST: Manifest = ${JSON.stringify({ ...MANIFEST_META, features }, null, 2)};
`;
  writeFileSync(resolve(here, '../remotion/manifest.generated.ts'), manifest);

  const all = Object.entries(runs).flatMap(([name, r]) => r.results.map((x) => ({ profile: name, ...x })));
  const log = Object.values(runs).flatMap((r) => r.log);
  const report = { when: new Date().toISOString(), url, steps: all, consoleErrors: log, passed: all.filter((r) => r.ok).length, failed: all.filter((r) => !r.ok).length };
  writeFileSync(join(OUT, 'walkthrough-report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.passed} passed, ${report.failed} failed, ${log.length} console errors`);
  if (report.failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
