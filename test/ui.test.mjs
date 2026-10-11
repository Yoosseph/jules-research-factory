import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { closeApp, listen, storeFixture, writePromptFixture } from './support/fixtures.mjs';

test('new users receive an introduction with working setup links and locally served design assets', async () => {
  const { directory, store, cleanup } = storeFixture('researchforge-ui-');
  const promptPath = writePromptFixture(directory);
  const app = createApp(store, { promptPath });
  const base = await listen(app);
  try {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, /Automate research/);
    assert.match(page, /href="\/setup">Connect Jules/);
    assert.match(page, /id="main-content"/);
    assert.doesNotMatch(page, /<nav|<footer|Already in motion|north star/);
    assert.match(page, /Workflow preview/);
    assert.match(response.headers.get('content-security-policy'), /font-src 'self'; script-src 'self'/);
    for (const font of ['fraunces', 'fraunces-italic', 'manrope']) {
      const asset = await fetch(`${base}/fonts/${font}.ttf`);
      assert.equal(asset.headers.get('content-type'), 'font/ttf');
      assert.deepEqual([...new Uint8Array(await asset.arrayBuffer()).slice(0, 4)], [0, 1, 0, 0]);
    }
    const script = await fetch(base + '/interface.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(base + '/fonts/secret.key')).status, 404);
    store.saveBinding({ owner: 'owner', repo: 'repo', fullName: 'owner/repo', githubId: '7', branch: 'main', sourceName: 'sources/repo' });
    store.set('configured', '1');
    assert.match(await (await fetch(base + '/welcome')).text(), /href="\/orchestrator">Open orchestrator/);
    const missingSource = await (await fetch(base + '/settings?error=' + encodeURIComponent('Could not locate owner/repo in Jules. The API key was accepted.'))).text();
    assert.match(missingSource, /href="\/setup\?rebind=1">Choose an available repository/);
    assert.match(missingSource, /href="https:\/\/jules.google.com\/"/);
  } finally {
    await closeApp(app);
    cleanup();
  }
});
