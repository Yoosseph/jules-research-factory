import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { openStore } from '../src/db.mjs';
import { bootstrapFromEnv } from '../src/bootstrap.mjs';

test('complete .env.local values verify and persist setup across restarts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'researchforge-bootstrap-'));
  let store = openStore(directory);
  const source = { name: 'sources/verified', githubRepo: { owner: 'example-owner', repo: 'example-research-repo', branches: [{ displayName: 'main' }] } };
  const jules = { sources: async () => [source], source: async () => source };
  const github = {
    user: async () => ({ login: 'example-owner' }),
    repo: async () => ({ id: 42, full_name: 'example-owner/example-research-repo', owner: { login: 'example-owner' }, name: 'example-research-repo' }),
    branch: async () => ({ commit: { sha: 'commit' } }),
    pulls: async () => [],
    commit: async () => ({ tree: { sha: 'tree' } }),
    tree: async () => ({ tree: [{ path: '2-Example', type: 'tree' }] })
  };
  const env = { JULES_API_KEY: 'jules-secret', GITHUB_TOKEN: 'github-secret', DEFAULT_GITHUB_OWNER: 'example-owner', DEFAULT_GITHUB_REPO: 'example-research-repo', DEFAULT_BASE_BRANCH: 'main', RESEARCH_RUNTIME: '60-120', DEVELOPMENT_SEEDS: '3', FINAL_SEEDS: '12', CONCURRENCY: '4' };
  try {
    assert.equal(await bootstrapFromEnv(store, env, { julesFactory: () => jules, githubFactory: () => github }), true);
    assert.equal(store.binding().github_repository_id, '42');
    assert.equal(store.get('configured'), '1');
    assert.equal(store.get('runtime'), '60–120');
    assert.equal(store.remoteFolders()[0].name, '2-Example');
    store.db.close();
    store = openStore(directory);
    assert.equal(store.getSecret('jules'), 'jules-secret');
    assert.equal(store.getSecret('github'), 'github-secret');
    assert.equal(store.get('concurrency'), '4');
    assert.equal(await bootstrapFromEnv(store, { ...env, DEFAULT_GITHUB_REPO: 'different' }, { julesFactory: () => jules, githubFactory: () => github }), false);
    assert.equal(store.binding().github_repo, 'example-research-repo');
  } finally {
    store.db.close();
    if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) rmSync(directory, { recursive: true, force: true });
  }
});
