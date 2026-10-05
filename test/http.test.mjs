import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.mjs';
import { bodyParams, idsFrom } from '../src/http.mjs';
import { storeFixture, writePromptFixture, listen, closeApp } from './support/fixtures.mjs';

function localApp(fixture) {
  return createApp(fixture.store, {
    promptPath: writePromptFixture(fixture.directory),
    julesFactory: () => { throw new Error('HTTP boundary tests must stay offline'); },
    githubFactory: () => { throw new Error('HTTP boundary tests must stay offline'); },
  });
}

test('HTTP refactor retains local access, security headers, asset contents and method handling', async () => {
  const fixture = storeFixture();
  const app = localApp(fixture);
  try {
    const base = await listen(app);
    const remote = await new Promise((resolve, reject) => {
      const req = request(base, { headers: { host: 'example.com' } }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body }));
        response.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(remote.status, 421);
    assert.equal(remote.body, 'Local access only');

    const page = await fetch(`${base}/setup/guide`);
    const content = await page.text();
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const stylesheet = content.match(/<style>([\s\S]*?)<\/style>/)[1];
    const styleHash = createHash('sha256').update(stylesheet).digest('base64');
    assert.ok(page.headers.get('content-security-policy').includes(`style-src 'sha256-${styleHash}'`));
    assert.match(content, /name="csrf"/);

    for (const [path, type, cache] of [
      ['/style.css', 'text/css; charset=utf-8', 'no-store'],
      ['/favicon-dark.svg', 'image/svg+xml', 'no-store'],
      ['/flow.js', 'text/javascript; charset=utf-8', 'no-cache'],
      ['/fonts/manrope.ttf', 'font/ttf', 'no-cache'],
    ]) {
      const asset = await fetch(`${base}${path}`);
      assert.equal(asset.status, 200);
      assert.equal(asset.headers.get('content-type'), type);
      assert.equal(asset.headers.get('cache-control'), cache);
      assert.deepEqual(Buffer.from(await asset.arrayBuffer()), readFileSync(new URL(`../public${path}`, import.meta.url)));
    }
    assert.equal((await fetch(`${base}/src/app.mjs`)).status, 404);
    assert.equal((await fetch(`${base}/fonts/manrope-OFL.txt`)).status, 404);
    assert.equal((await fetch(base, { method: 'PUT' })).status, 405);
  } finally {
    await closeApp(app);
    fixture.cleanup();
  }
});

test('form tokens protect each app instance and valid local forms still redirect', async () => {
  const fixtures = [storeFixture(), storeFixture()];
  const apps = fixtures.map(localApp);
  try {
    const bases = await Promise.all(apps.map(listen));
    const tokens = await Promise.all(bases.map(async base => {
      const page = await (await fetch(`${base}/setup/guide`)).text();
      return page.match(/name="csrf" value="([^"]+)"/)[1];
    }));
    assert.notEqual(tokens[0], tokens[1]);
    const submit = (base, csrf) => fetch(`${base}/setup/refresh-sources`, {
      method: 'POST', body: new URLSearchParams({ csrf }), redirect: 'manual',
    });
    assert.equal((await submit(bases[0], '')).status, 403);
    assert.equal((await submit(bases[1], tokens[0])).status, 403);
    const accepted = await submit(bases[1], tokens[1]);
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get('location'), '/setup');
  } finally {
    await Promise.all(apps.map(closeApp));
    for (const fixture of fixtures) fixture.cleanup();
  }
});

test('form parsing keeps its byte limit and selected projects remain bounded and unique', async () => {
  const form = await bodyParams(Readable.from([Buffer.from('topic=caf%C3'), Buffer.from('%A9&topic=two')]));
  assert.deepEqual(form.getAll('topic'), ['café', 'two']);
  await assert.rejects(bodyParams(Readable.from([Buffer.alloc(65536), Buffer.from('x')])), /Form is too large/);

  const id = '00000000-0000-0000-0000-000000000001';
  assert.deepEqual(idsFrom(new URLSearchParams({ projectId: id })), [id]);
  assert.deepEqual(idsFrom(new URLSearchParams({ id })), [id]);
  assert.throws(() => idsFrom(new URLSearchParams(`id=${id}&id=${id}`)), /Duplicate/);
  assert.throws(() => idsFrom(new URLSearchParams({ id: '../private' })), /valid projects/);
  assert.throws(() => idsFrom(new URLSearchParams(Array.from({ length: 51 }, () => ['id', id]))), /1–50/);
});
