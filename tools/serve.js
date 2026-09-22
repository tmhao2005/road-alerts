// Serve site/ locally for checking the screen at a desk. Safari only grants GPS on
// https or localhost, so on a laptop open http://localhost:8080/?at=10.7743,106.7010 to
// pin a position; the iPhone test uses the GitHub Pages link instead. A phone on the same
// Wi-Fi can open the LAN address for the demo drives, which need no GPS.
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = 'site';
const PORT = Number(process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(ROOT, path.endsWith('/') ? `${path}index.html` : path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => {
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  console.log(`On this Mac:   http://localhost:${PORT}/`);
  if (lan) console.log(`On the phone:  http://${lan.address}:${PORT}/  (same Wi-Fi; demo drives only, GPS needs https)`);
});
