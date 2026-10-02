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

