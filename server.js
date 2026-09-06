// Tiny static server so the same UI can be previewed in a browser.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = (process.env.PORT && process.env.PORT !== '0' && +process.env.PORT > 0) ? +process.env.PORT : 4173;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    // malformed percent-encoding (e.g. /%zz) would throw and crash the process
    res.writeHead(400); res.end('Bad request'); return;
  }
  if (urlPath.includes('\\') || urlPath.includes('\0')) {
    res.writeHead(400); res.end('Bad request'); return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  // pallettai.org/ref/CODE → the referral redemption page (code parsed client-side)
  if (urlPath === '/ref' || urlPath.startsWith('/ref/')) urlPath = '/ref.html';
  const filePath = path.resolve(ROOT, '.' + urlPath);
  const rootPrefix = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (filePath !== ROOT && !filePath.startsWith(rootPrefix)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // GitHub Pages parity: any unknown path serves 404.html, which hosts
      // the /ref/CODE forwarding and the /auth/... confirmation handler
      fs.readFile(path.join(ROOT, '404.html'), (err2, data2) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(data2);
      });
      return;
    }
    // no-store so the studio always runs the latest code (never a stale cache)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const addr = server.address();
  console.log(`PallettAI Studio running at http://localhost:${addr.port}`);
});