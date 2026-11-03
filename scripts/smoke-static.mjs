import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

const port = 3100;
const base = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/nexter',
    SETUP_TOKEN: 'test-setup-token',
    AUTH_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    APP_URL: `http://127.0.0.1:${port}`,
    WEB_DIST_PATH: 'apps/web/dist',
    ENABLE_DOCS: 'false',
    LOG_LEVEL: 'silent',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // Server is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`API did not become ready.\n${output}`);
}

async function main() {
  await waitForHealth();

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200, 'GET / must return 200');
  const indexHtml = await index.text();
  assert.match(indexHtml, /Nexter/, 'GET / must serve the SPA');

  const deepLink = await fetch(`${base}/portfolio`);
  assert.equal(deepLink.status, 200, 'SPA deep link must return 200');
  assert.match(await deepLink.text(), /Nexter/, 'SPA deep link must serve index.html');

  const headDeepLink = await fetch(`${base}/dashboard`, { method: 'HEAD' });
  assert.equal(headDeepLink.status, 200, 'SPA HEAD deep link must return 200');

  const assetPath = indexHtml.match(/\/assets\/[^"']+\.js/)?.[0];
  assert.ok(assetPath, 'index.html must reference a JS asset');

  const asset = await fetch(`${base}${assetPath}`);
  assert.equal(asset.status, 200, 'static asset must return 200');
  const assetBody = new Uint8Array(await asset.arrayBuffer());
  const contentLength = asset.headers.get('content-length');

  if (contentLength) {
    assert.equal(
      Number(contentLength),
      assetBody.byteLength,
      'static asset Content-Length must match the body length',
    );
  }

  const gzipAsset = await fetch(`${base}${assetPath}`, {
    headers: { 'Accept-Encoding': 'gzip' },
  });
  const gzipBody = new Uint8Array(await gzipAsset.arrayBuffer());
  const encoding = gzipAsset.headers.get('content-encoding');

  if (encoding === 'gzip') {
    const decoded = gunzipSync(gzipBody);
    assert.equal(
      decoded.byteLength,
      assetBody.byteLength,
      'gzip static asset must decompress to the original length',
    );
  } else {
    assert.equal(
      gzipBody.byteLength,
      assetBody.byteLength,
      'uncompressed static asset must be delivered in full',
    );
  }

  const notFound = await fetch(`${base}/api/v1/unknown`);
  assert.equal(notFound.status, 404, 'unknown API route must return 404');
  const notFoundBody = await notFound.json();
  assert.equal(notFoundBody.error?.code, 'NOT_FOUND', '404 must use the error envelope');

  const healthHeaders = await fetch(`${base}/health`);
  assert.equal(healthHeaders.status, 200);
  assert.equal(
    healthHeaders.headers.get('x-frame-options')?.toLowerCase(),
    'deny',
    'X-Frame-Options must be DENY',
  );
  assert.equal(
    healthHeaders.headers.get('referrer-policy'),
    'strict-origin-when-cross-origin',
    'Referrer-Policy must be strict-origin-when-cross-origin',
  );
  assert.equal(
    healthHeaders.headers.get('permissions-policy'),
    'camera=(), microphone=(), geolocation=()',
    'Permissions-Policy must restrict camera, microphone, and geolocation',
  );
  assert.match(
    healthHeaders.headers.get('content-security-policy') ?? '',
    /frame-ancestors 'none'/,
    'CSP must deny framing',
  );

  console.log('Static/API smoke test passed');
}

main()
  .catch((error) => {
    console.error(error);
    console.error(output);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill('SIGTERM');
  });
