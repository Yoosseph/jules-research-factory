import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/db.mjs';
import { storeFixture, temporaryDirectory } from './support/fixtures.mjs';

test('a new numbering series can start at 1 while old local history remains', () => {
  const { store, cleanup } = storeFixture('researchforge-numbering-');
  try {
    store.saveBinding({ owner: 'Owner', repo: 'repo', fullName: 'Owner/repo', githubId: '42', branch: 'main', sourceName: 'sources/repo' });
    const old = store.reserve(['Yesterday']);
    assert.throws(() => store.setNextProjectNumber(1), /Clear reserved projects/);
    store.db.prepare("UPDATE projects SET status='pr_validated' WHERE id=?").run(old[0].id);
    assert.equal(store.setNextProjectNumber(1), 1);
    const fresh = store.reserve(['Yesterday'])[0];
    assert.equal(fresh.folder_number, 1);
    assert.equal(fresh.folder, old[0].folder);
    assert.notEqual(fresh.number_generation, old[0].number_generation);
    assert.equal(store.project(old[0].id).status, 'pr_validated');
    assert.equal(store.nextProjectNumber(), 2);
    store.db.prepare("UPDATE projects SET status='stopped' WHERE id=?").run(fresh.id);
    store.clearProjects('finished');
    assert.equal(store.nextProjectNumber(), 2);
    store.replaceRemoteFolders([{ name: '2-Already-Here', number: 2 }]);
    assert.equal(store.nextProjectNumber(), 3);
    assert.equal(store.reserve(['Another'])[0].folder_number, 3);
  } finally {
    cleanup();
  }
});

test('an existing database keeps project history during numbering migration', () => {
  const { directory, cleanup } = temporaryDirectory('researchforge-numbering-migrate-');
  const path = join(directory, 'researchforge.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE projects (
    id TEXT PRIMARY KEY, topic TEXT NOT NULL, slug TEXT NOT NULL,
    folder_number INTEGER NOT NULL UNIQUE, folder TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL, binding_identity TEXT NOT NULL, repository_full_name TEXT NOT NULL,
    base_branch TEXT NOT NULL, jules_session_name TEXT, jules_session_url TEXT,
    pr_url TEXT, pr_status TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`);
  legacy.prepare('INSERT INTO projects(id,topic,slug,folder_number,folder,status,binding_identity,repository_full_name,base_branch,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('old-id', 'Yesterday', 'Yesterday', 1, '1-Yesterday', 'pr_validated', '42|sources/repo|main', 'Owner/repo', 'main', '2026-09-22', '2026-09-22');
  legacy.close();
  const store = openStore(directory);
  try {
    store.saveBinding({ owner: 'Owner', repo: 'repo', fullName: 'Owner/repo', githubId: '42', branch: 'main', sourceName: 'sources/repo' });
    assert.equal(store.project('old-id').number_generation, 0);
    assert.equal(store.setNextProjectNumber(1), 1);
    const fresh = store.reserve(['Yesterday'])[0];
    assert.equal(fresh.folder, '1-Yesterday');
    assert.equal(store.project('old-id').folder, '1-Yesterday');
    assert.equal(fresh.number_generation, 1);
  } finally {
    store.db.close();
    cleanup();
  }
});
