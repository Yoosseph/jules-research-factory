import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/db.mjs';
import { githubClient, julesClient } from '../src/providers.mjs';
import { storeFixture, temporaryDirectory } from './support/fixtures.mjs';

function legacyProject(db, optionalColumns = '') {
  db.exec(`CREATE TABLE projects (
    id TEXT PRIMARY KEY, topic TEXT NOT NULL, slug TEXT NOT NULL,
    folder_number INTEGER NOT NULL UNIQUE, folder TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL, jules_session_name TEXT, jules_session_url TEXT,
    pr_url TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ${optionalColumns}
  );`);
  db.prepare('INSERT INTO projects(id,topic,slug,folder_number,folder,status,jules_session_name,jules_session_url,pr_url,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('legacy-id', 'Legacy research', 'Legacy-research', 7, '7-Legacy-research', 'completed', 'sessions/legacy', 'https://jules.google/session/legacy', 'https://github.com/owner/repo/pull/8', 'Earlier error', '2026-09-01', '2026-09-02');
}

test('the oldest project schema gains binding fields without losing its history', () => {
  const { directory, cleanup } = temporaryDirectory('research-facility-oldest-schema-');
  const legacy = new DatabaseSync(join(directory, 'researchforge.sqlite'));
  let legacyOpen = true;
  let store;
  try {
    legacyProject(legacy);
    const previous = legacy.prepare('SELECT * FROM projects').get();
    legacy.close();
    legacyOpen = false;
    store = openStore(directory);
    const migrated = store.project('legacy-id');
    for (const [name, value] of Object.entries(previous)) assert.equal(migrated[name], value);
    assert.equal(migrated.number_generation, 0);
    assert.equal(migrated.binding_identity, '');
    assert.equal(migrated.repository_full_name, '');
    assert.equal(migrated.base_branch, '');
    assert.equal(migrated.orchestrator_instructions, null);
    assert.equal(store.nextProjectNumber(), 8);
  } finally {
    if (legacyOpen) legacy.close();
    store?.db.close();
    cleanup();
  }
});

test('numbering migration preserves all previously stored optional project fields across restarts', () => {
  const { directory, cleanup } = temporaryDirectory('research-facility-migration-fields-');
  const legacy = new DatabaseSync(join(directory, 'researchforge.sqlite'));
  let legacyOpen = true;
  let store;
  try {
    legacyProject(legacy, `,
      binding_identity TEXT NOT NULL DEFAULT '', repository_full_name TEXT NOT NULL DEFAULT '',
      base_branch TEXT NOT NULL DEFAULT '', pr_status TEXT, prompt_text TEXT, jules_state TEXT,
      jules_polled_at TEXT, activity_error TEXT, orchestrator_instructions TEXT`);
    legacy.prepare('UPDATE projects SET binding_identity=?,repository_full_name=?,base_branch=?,pr_status=?,prompt_text=?,jules_state=?,jules_polled_at=?,activity_error=?,orchestrator_instructions=?')
      .run('42|sources/repo|main', 'owner/repo', 'main', 'open', 'Saved prompt', 'COMPLETED', '2026-09-03', 'Earlier activity error', 'Keep the original research instructions');
    const previous = legacy.prepare('SELECT * FROM projects').get();
    legacy.close();
    legacyOpen = false;
    store = openStore(directory);
    store.setSecret('jules', 'test-local-key');
    assert.deepEqual({ ...store.project('legacy-id') }, { ...previous, number_generation: 0 });
    store.db.close();
    store = openStore(directory);
    assert.deepEqual({ ...store.project('legacy-id') }, { ...previous, number_generation: 0 });
    assert.equal(store.getSecret('jules'), 'test-local-key');
  } finally {
    if (legacyOpen) legacy.close();
    store?.db.close();
    cleanup();
  }
});

test('a failed legacy migration rolls back added columns and leaves the original project intact', () => {
  const { directory, cleanup } = temporaryDirectory('research-facility-migration-rollback-');
  const path = join(directory, 'researchforge.sqlite');
  const legacy = new DatabaseSync(path);
  let legacyOpen = true;
  let check;
  try {
    legacyProject(legacy);
    legacy.exec('CREATE TABLE projects_next (id TEXT PRIMARY KEY);');
    const columns = legacy.prepare('PRAGMA table_info(projects)').all();
    const previous = legacy.prepare('SELECT * FROM projects').get();
    legacy.close();
    legacyOpen = false;
    assert.throws(() => openStore(directory), /already exists/);
    check = new DatabaseSync(path);
    assert.deepEqual(check.prepare('PRAGMA table_info(projects)').all(), columns);
    assert.deepEqual(check.prepare('SELECT * FROM projects').get(), previous);
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM projects_next').get().n, 0);
  } finally {
    if (legacyOpen) legacy.close();
    check?.close();
    cleanup();
  }
});

test('failed reservation and folder batches roll back completely and allow the next operation', () => {
  const { store, cleanup } = storeFixture('research-facility-store-rollback-');
  try {
    store.saveBinding({ owner: 'owner', repo: 'repo', fullName: 'owner/repo', githubId: '42', branch: 'main', sourceName: 'sources/repo' });
    assert.throws(() => store.reserve(['Partial reservation', null]), TypeError);
    assert.deepEqual(store.projects(), []);
    assert.equal(store.nextProjectNumber(), 1);
    assert.equal(store.reserve(['Complete reservation'])[0].folder_number, 1);

    store.replaceRemoteFolders([{ name: '5-Existing', number: 5 }]);
    assert.throws(() => store.replaceRemoteFolders([{ name: '8-New', number: 8 }, { name: '8-New', number: 8 }]), /UNIQUE/);
    assert.deepEqual(store.remoteFolders().map(item => ({ ...item })), [{ name: '5-Existing', number: 5 }]);
    store.replaceRemoteFolders([{ name: '9-Complete', number: 9 }]);
    assert.equal(store.nextProjectNumber(), 10);
  } finally { cleanup(); }
});

test('source pagination retains token encoding and excludes incomplete repository sources', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(new URL(url));
    return { ok: true, json: async () => urls.length === 1
      ? { sources: [{ name: 'sources/valid', githubRepo: { owner: 'owner', repo: 'repo' } }, { name: 'sources/incomplete' }], nextPageToken: 'with /+?' }
      : { sources: [{ name: 'sources/next', githubRepo: { owner: 'owner', repo: 'next' } }] } };
  });
  const sources = await julesClient('test-key').sources();
  assert.deepEqual(sources.map(item => item.name), ['sources/valid', 'sources/next']);
  assert.equal(urls[1].searchParams.get('pageToken'), 'with /+?');
  assert.equal(urls[1].searchParams.get('pageSize'), '100');
});

test('GitHub branch and pull-file lists continue after a full page and stop at an empty page', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url);
    urls.push(parsed);
    return { ok: true, json: async () => parsed.searchParams.get('page') === '1' ? Array.from({ length: 100 }, (_, index) => ({ name: `item-${index}` })) : [] };
  });
  const github = githubClient('test-token');
  assert.equal((await github.branches('owner', 'repo')).length, 100);
  assert.equal((await github.pullFiles('owner', 'repo', 8)).length, 100);
  assert.deepEqual(urls.map(url => url.pathname), ['/repos/owner/repo/branches', '/repos/owner/repo/branches', '/repos/owner/repo/pulls/8/files', '/repos/owner/repo/pulls/8/files']);
  assert.deepEqual(urls.map(url => url.searchParams.get('page')), ['1', '2', '1', '2']);
  assert.ok(urls.every(url => url.searchParams.get('per_page') === '100'));
});

test('Jules pagination retains the capacity and activity history limits', async t => {
  let count = 0;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ nextPageToken: `page-${++count}` }) }));
  await assert.rejects(julesClient('test-key').sessions(), /history is too large/);
  assert.equal(count, 101);
  count = 0;
  await assert.rejects(julesClient('test-key').activities('sessions/test'), /more than 5,000 activities/);
  assert.equal(count, 51);
  fetchMock.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ activities: Array(5001).fill({}) }) }));
  await assert.rejects(julesClient('test-key').activities('sessions/test'), /more than 5,000 activities/);
  fetchMock.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ activities: Array(5000).fill({}) }) }));
  assert.equal((await julesClient('test-key').activities('sessions/test')).length, 5000);
});

test('every session operation rejects an invalid identifier before calling Jules', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected request'); });
  const jules = julesClient('test-key');
  for (const operation of ['session', 'deleteSession', 'approvePlan', 'sendMessage']) {
    assert.throws(() => jules[operation]('sessions/invalid/path', 'Valid message'), /Invalid Jules session name/);
  }
  await assert.rejects(jules.activities('sessions/invalid/path'), /Invalid Jules session name/);
  assert.equal(fetchMock.mock.callCount(), 0);
});
