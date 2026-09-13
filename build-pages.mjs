// Wraps index.html (the artifact source, which has no <html>/<head>/<body>)
// into a complete page at docs/index.html for GitHub Pages.
// Run: node build-pages.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const body = readFileSync("index.html", "utf8");
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Mahgeong: a daily geography puzzle played like mahjong solitaire. One board a day, the same for everyone.">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 14px system-ui, sans-serif; background: #faf9f6; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
`;
const tail = `
</body>
</html>
`;
mkdirSync("docs", { recursive: true });
writeFileSync("docs/index.html", head + body + tail);
console.log(`docs/index.html written (${(head.length + body.length + tail.length).toLocaleString()} bytes)`);
