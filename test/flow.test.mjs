import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { openStore } from '../src/db.mjs';
import { createApp } from '../src/app.mjs';
import { initializeFlow, recordPacket, flowSnapshot } from '../src/flow.mjs';
import { layout } from '../src/ui.mjs';

test('flow retains actual conversations, scopes tasks, and redacts saved credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'research-flow-'));
  const store = openStore(directory);
  try {
    initializeFlow(store);
    store.saveBinding({ owner: 'owner', repo: 'repo', fullName: 'owner/repo', githubId: '1', branch: 'main', sourceName: 'sources/repo' });
    store.setSecret('jules', 'private-jules-key');
    const [first, second] = store.reserve(['Research one', 'Research two']);
    recordPacket(store, { projectId: first.id, from: 'model', to: 'jules', title: 'Plan', content: 'Investigate pricing. private-jules-key' });
    recordPacket(store, { projectId: second.id, title: 'Another task', content: 'Different plan' });
    store.db.prepare('INSERT INTO jules_activities VALUES (?,?,?,?,?,?,?)').run('sessions/one/activities/question', first.id, 'message', 'agent', 'Jules message', 'Which market should I study?', new Date().toISOString());
    const snapshot = flowSnapshot(store, { projectId: first.id });
    assert.equal(snapshot.packets.length, 2);
    assert.ok(snapshot.packets.every(p => p.projectId === first.id));
    assert.match(JSON.stringify(snapshot), /Which market should I study/);
    assert.doesNotMatch(JSON.stringify(snapshot), /private-jules-key|Different plan|secret:/);
    assert.match(JSON.stringify(snapshot), /redacted/);
    store.db.prepare("UPDATE projects SET status='completed' WHERE id=?").run(first.id);
    store.clearProjects('finished');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM agent_packets WHERE project_id=?').get(first.id).n, 0);
  } finally { store.db.close(); if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) rmSync(directory, { recursive: true, force: true }); }
});

test('flow stream publishes new packets and closes cleanly; theme and notice controls remain accessible', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'research-stream-'));
  const store = openStore(directory);
  const promptPath = join(directory, 'prompt.txt');
  writeFileSync(promptPath, readFileSync(new URL('../prompt-template.txt', import.meta.url)));
  store.saveBinding({ owner: 'owner', repo: 'repo', fullName: 'owner/repo', githubId: '1', branch: 'main', sourceName: 'sources/repo' });
  store.set('configured', '1');
  const app = createApp(store, { promptPath });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let reader;
  try {
    const page = await (await fetch(base + '/flow')).text();
    assert.match(page, /data-theme-toggle.*aria-label="Switch color theme"/);
    assert.match(page, /data-live-flow/);
    assert.doesNotMatch(page, /http-equiv="refresh"/);
    assert.match(page, /src="\/flow.js"/);
    for (const asset of ['/flow.js', '/theme.js', '/favicon-dark.svg']) assert.equal((await fetch(base + asset)).status, 200);
    const response = await fetch(base + '/api/flow/stream', { signal: controller.signal });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /event: snapshot/);
    recordPacket(store, { from: 'model', to: 'jules', title: 'A live packet', content: 'Compare published pricing.' });
    let update = '';
    while (!update.includes('A live packet')) {
      const result = await reader.read();
      if (result.done) throw new Error('Stream ended before new packet');
      update += decoder.decode(result.value);
    }
    assert.match(update, /Compare published pricing/);
    assert.equal((await fetch(base + '/api/flow?project=unknown')).status, 404);
    const notices = layout('Notice checks', '<main><div class="notice">Choose a repository.</div><div class="notice">Access denied.</div><div class="notice success">Saved.</div></main>');
    assert.match(notices, /notice action[^>]*>Choose/);
    assert.match(notices, /notice error[^>]*>Access denied/);
    assert.match(notices, /notice success[^>]*>Saved/);
  } finally {
    controller.abort();
    clearTimeout(timeout);
    await reader?.cancel().catch(() => {});
    app.close(); store.db.close();
    if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) rmSync(directory, { recursive: true, force: true });
  }
});
