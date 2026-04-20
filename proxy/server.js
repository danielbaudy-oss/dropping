/* ============================
   Home Proxy Server
   Fetches URLs from residential IP on behalf of Apps Script
   ============================ */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT || '8080', 10);
const SECRET = process.env.PROXY_SECRET || '';

if (!SECRET) {
  console.error('PROXY_SECRET env var is required');
  process.exit(1);
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
];

function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function fetchUrl(targetUrl, extraHeaders, cb) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    return cb(new Error('Invalid URL'));
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return cb(new Error('Only http/https allowed'));
  }

  const lib = parsed.protocol === 'https:' ? https : http;
  const headers = Object.assign({
    'User-Agent': pickUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity', // disable gzip so we don't have to decompress
    'Cache-Control': 'no-cache'
  }, extraHeaders || {});

  const req = lib.request({
    method: 'GET',
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + parsed.search,
    headers: headers,
    timeout: 25000
  }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      cb(null, {
        status: res.statusCode,
        headers: res.headers,
        body: body
      });
    });
  });

  req.on('error', (err) => cb(err));
  req.on('timeout', () => { req.destroy(new Error('Request timeout')); });
  req.end();
}

function handleRequest(req, res) {
  const reqUrl = new URL(req.url, 'http://localhost');

  // Health check
  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
  }

  // Auth check
  const providedSecret = req.headers['x-proxy-secret'] || reqUrl.searchParams.get('secret');
  if (providedSecret !== SECRET) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  if (reqUrl.pathname !== '/fetch') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Not found' }));
  }

  const targetUrl = reqUrl.searchParams.get('url');
  if (!targetUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing url parameter' }));
  }

  // Optional custom headers via ?referer= and ?origin=
  const extraHeaders = {};
  const refParam = reqUrl.searchParams.get('referer');
  const originParam = reqUrl.searchParams.get('origin');
  if (refParam) extraHeaders['Referer'] = refParam;
  if (originParam) extraHeaders['Origin'] = originParam;

  console.log(`[${new Date().toISOString()}] GET ${targetUrl}`);

  fetchUrl(targetUrl, extraHeaders, (err, result) => {
    if (err) {
      console.error(`  ERROR: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
    console.log(`  -> HTTP ${result.status}, ${result.body.length} bytes`);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      status: result.status,
      headers: result.headers,
      body: result.body
    }));
  });
}

const server = http.createServer(handleRequest);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy listening on port ${PORT}`);
});
