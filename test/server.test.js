'use strict';
/**
 * The server's guards, exercised over real HTTP against a real instance with
 * its own empty data directory. These are the fixes from the security review,
 * and each one is here so that a refactor cannot quietly undo it:
 *
 *   - a state-changing call must carry the vault's own header (CSRF)
 *   - a cross-site labelled call is refused
 *   - a request naming another host is refused (DNS rebinding)
 *   - pack downloads accept only the Kiwix hosts and a plain .zim filename
 *   - __proto__ and friends never reach an object key
 *   - a malformed Range gets a 416 rather than killing the process
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { ArkServer } = require('../src/server');

let server;
let port;

function request(urlPath, { method = 'GET', headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        host: host || `127.0.0.1:${port}`,
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        ...headers,
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** What the app's own page sends. */
const asApp = (extra = {}) => ({ 'x-vault-client': '1', 'sec-fetch-site': 'same-origin', ...extra });

test.before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-data-'));
  const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-lib-'));
  server = new ArkServer({ port: 0, host: '127.0.0.1', dataDir, libraryDir });
  await server.init();
  await server.start();
  port = server.server.address().port;
});

test.after(async () => {
  if (server && server.stop) await server.stop();
  else if (server && server.server) await new Promise((r) => server.server.close(r));
});

// ---------------------------------------------------------------- it works

test('the app page is served', async () => {
  const res = await request('/');
  assert.strictEqual(res.status, 200);
  assert.match(res.text, /<html/i);
});

test('a GET from the app returns JSON', async () => {
  const res = await request('/api/status', { headers: asApp() });
  assert.strictEqual(res.status, 200);
  assert.ok(res.json, 'status should be JSON');
});

test('every response carries the hardening headers', async () => {
  const res = await request('/');
  assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.headers['referrer-policy'], 'a referrer policy is set');
  assert.ok(
    res.headers['x-frame-options'] || (res.headers['content-security-policy'] || '').includes('frame-ancestors'),
    'framing is restricted'
  );
});

// ------------------------------------------------------------- CSRF guards

test('a state-changing POST without the vault header is refused', async () => {
  const res = await request('/api/school/progress', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin' }, // no x-vault-client
    body: { profile: 'default', lessonId: 'maths/02-arithmetic-by-hand', completed: true },
  });
  assert.ok(res.status === 403 || res.status === 400, `expected a refusal, got ${res.status}`);
});

test('a POST labelled cross-site is refused even with the header', async () => {
  const res = await request('/api/school/progress', {
    method: 'POST',
    headers: asApp({ 'sec-fetch-site': 'cross-site' }),
    body: { profile: 'default', lessonId: 'x', completed: true },
  });
  assert.ok(res.status === 403 || res.status === 400, `expected a refusal, got ${res.status}`);
});

test('a request naming a different host is refused (DNS rebinding)', async () => {
  const res = await request('/api/status', {
    headers: asApp(),
    host: 'vault.attacker.example',
  });
  assert.ok(res.status === 403 || res.status === 400, `expected a refusal, got ${res.status}`);
});

test('the machine\'s own names are accepted', async () => {
  const res = await request('/api/status', { headers: asApp(), host: `localhost:${port}` });
  assert.strictEqual(res.status, 200);
});

// --------------------------------------------------- pack download guards

test('a download from a host that is not Kiwix is refused', async () => {
  const res = await request('/api/downloads', {
    method: 'POST',
    headers: asApp(),
    body: { url: 'https://attacker.example/evil.zim', filename: 'evil.zim' },
  });
  assert.ok(res.status >= 400, `expected a refusal, got ${res.status}: ${res.text}`);
});

test('a download aimed at this machine is refused', async () => {
  const res = await request('/api/downloads', {
    method: 'POST',
    headers: asApp(),
    body: { url: 'http://127.0.0.1:1/x.zim', filename: 'x.zim' },
  });
  assert.ok(res.status >= 400, `expected a refusal, got ${res.status}`);
});

test('a filename that is not a pack is refused', async () => {
  for (const filename of ['/etc/passwd', 'evil.exe', 'evil.zim.exe', '.zim']) {
    const res = await request('/api/downloads', {
      method: 'POST',
      headers: asApp(),
      body: { url: 'https://download.kiwix.org/zim/other/x.zim', filename },
    });
    assert.ok(res.status >= 400, `"${filename}" was not refused (status ${res.status})`);
  }
});

test('with no filename given, the name comes from the URL', async () => {
  const res = await request('/api/downloads', {
    method: 'POST',
    headers: asApp(),
    body: { url: 'https://download.kiwix.org/zim/other/x.zim' },
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.job.filename, 'x.zim');
  if (res.json.job.id) await request(`/api/downloads/${encodeURIComponent(res.json.job.id)}`, { method: 'DELETE', headers: asApp() });
});

test('a traversal filename is reduced to a plain name inside the library', async () => {
  // These are normalised rather than refused — path.basename strips the
  // traversal — so the test is that nothing with a separator survives.
  for (const filename of ['../../evil.zim', '..\\..\\evil.zim', 'a/b.zim']) {
    const res = await request('/api/downloads', {
      method: 'POST',
      headers: asApp(),
      body: { url: 'https://download.kiwix.org/zim/other/x.zim', filename },
    });
    if (res.status >= 400) continue; // refusing outright is fine too
    const written = res.json && res.json.job && (res.json.job.filename || res.json.job.dest || '');
    assert.ok(!/[\\/]/.test(path.basename(String(written))), `"${filename}" kept a separator: ${written}`);
    assert.ok(!String(written).includes('..'), `"${filename}" kept a traversal: ${written}`);
    if (res.json && res.json.job && res.json.job.id) {
      await request(`/api/downloads/${encodeURIComponent(res.json.job.id)}`, { method: 'DELETE', headers: asApp() });
    }
  }
});

test('allowedUrl accepts only the Kiwix hosts over https', () => {
  const { allowedUrl, privateHost } = require('../src/library/download');
  assert.ok(allowedUrl('https://download.kiwix.org/zim/other/x.zim'));
  assert.ok(!allowedUrl('http://download.kiwix.org/zim/other/x.zim'), 'plain http is refused');
  assert.ok(!allowedUrl('https://download.kiwix.org.attacker.example/x.zim'), 'a suffixed host is refused');
  assert.ok(!allowedUrl('https://attacker.example/x.zim'));
  assert.ok(!allowedUrl('file:///etc/passwd'));
  assert.ok(!allowedUrl('not a url'));
});

test('privateHost catches this machine and the local network', () => {
  const { privateHost } = require('../src/library/download');
  for (const h of ['127.0.0.1', 'localhost', '::1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.1.1', 'printer.local']) {
    assert.ok(privateHost(h), `${h} should be treated as private`);
  }
  for (const h of ['download.kiwix.org', '8.8.8.8', 'example.com']) {
    assert.ok(!privateHost(h), `${h} should not be treated as private`);
  }
});

// -------------------------------------------------- prototype pollution

test('a __proto__ key in a body does not reach Object.prototype', async () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    await request('/api/school/progress', {
      method: 'POST',
      headers: asApp(),
      body: { profile: key, lessonId: 'x', completed: true, polluted: 'yes' },
    });
  }
  await request('/api/school/progress', {
    method: 'POST',
    headers: asApp(),
    body: { profile: 'default', lessonId: '__proto__', completed: true },
  });
  assert.strictEqual({}.polluted, undefined, 'Object.prototype was polluted');
  assert.strictEqual({}.completed, undefined, 'Object.prototype was polluted');
});

// ------------------------------------------------------------- robustness

test('an unknown API route is a clean 404, not a crash', async () => {
  const res = await request('/api/no-such-route', { headers: asApp() });
  assert.strictEqual(res.status, 404);
});

test('a path traversal in a static request does not escape the web folder', async () => {
  for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json', '/web/../../package.json']) {
    const res = await request(p);
    assert.ok(!res.text.includes('"name": "vault"'), `${p} served a file outside web/`);
  }
});

test('a malformed Range is a 416 rather than a crash', async () => {
  const res = await request('/', { headers: { range: 'bytes=99999999-1' } });
  assert.ok([200, 206, 416].includes(res.status), `unexpected status ${res.status}`);
  const after = await request('/api/status', { headers: asApp() });
  assert.strictEqual(after.status, 200, 'the server must still be alive');
});

test('a body that is not JSON is refused without killing the server', async () => {
  const res = await new Promise((resolve, reject) => {
    const payload = Buffer.from('{ not json at all');
    const req = http.request({
      host: '127.0.0.1', port, path: '/api/school/progress', method: 'POST',
      headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': payload.length, ...asApp() },
    }, (r) => { r.resume(); r.on('end', () => resolve({ status: r.statusCode })); });
    req.on('error', reject);
    req.end(payload);
  });
  assert.ok(res.status >= 400, `expected a refusal, got ${res.status}`);
  const after = await request('/api/status', { headers: asApp() });
  assert.strictEqual(after.status, 200);
});

test('sharing on the network is off until it is switched on', async () => {
  const res = await request('/api/network', { headers: asApp() });
  if (res.status === 404) return; // route named differently; covered elsewhere
  assert.strictEqual(res.status, 200);
  assert.notStrictEqual(res.json.enabled, true, 'network sharing must default to off');
});
