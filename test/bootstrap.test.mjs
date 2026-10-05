import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/db.mjs';
import { storeFixture, temporaryDirectory } from './support/fixtures.mjs';
import { bootstrapFromEnv, applyApiKeysFromEnv } from '../src/bootstrap.mjs';

test('environment keys replace saved keys without changing research or repository settings', () => {
  const { store, cleanup } = storeFixture('researchforge-keys-');
  try {
    const settings = { provider: 'nvidia', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'saved-model', brief: 'Market research forever', enabled: true, mode: 'continuous', dailyLimit: 0 };
    store.set('orchestrator', JSON.stringify(settings));
    store.setSecret('jules', 'old-jules-key');
    store.setSecret('orchestrator', 'old-nvidia-key');
    store.set('orchestratorRetryAt', '2099-01-01T00:00:00Z');
    store.set('orchestratorCount', 7);
    assert.equal(applyApiKeysFromEnv(store, { JULES_API_KEY: ' new-jules-key ', NVIDIA_API_KEY: ' new-nvidia-key ' }), true);
    assert.equal(store.getSecret('jules'), 'new-jules-key');
    assert.equal(store.getSecret('orchestrator'), 'new-nvidia-key');
    assert.deepEqual(JSON.parse(store.get('orchestrator')), settings);
    assert.equal(store.get('orchestratorRetryAt'), '');
    assert.equal(store.get('orchestratorCount'), '7');
    assert.equal(applyApiKeysFromEnv(store, { JULES_API_KEY: '', NVIDIA_API_KEY: ' ' }), false);
    assert.equal(store.getSecret('jules'), 'new-jules-key');
    assert.equal(store.getSecret('orchestrator'), 'new-nvidia-key');
  } finally {
    cleanup();
  }
});

test('NVIDIA environment key initializes a disabled provider and never replaces another provider key', () => {
  const { store, cleanup } = storeFixture('researchforge-provider-key-');
  try {
    applyApiKeysFromEnv(store, { NVIDIA_API_KEY: 'nvidia-key' });
    assert.equal(store.getSecret('orchestrator'), 'nvidia-key');
    assert.equal(JSON.parse(store.get('orchestrator')).enabled, false);
    store.set('orchestrator', JSON.stringify({ provider: 'compatible', endpoint: 'https://example.com/chat/completions' }));
    store.setSecret('orchestrator', 'compatible-key');
    assert.equal(applyApiKeysFromEnv(store, { NVIDIA_API_KEY: 'other-nvidia-key' }), false);
    assert.equal(store.getSecret('orchestrator'), 'compatible-key');
  } finally {
    cleanup();
  }
});

test('complete .env.local values verify and persist setup across restarts', async () => {
  const { directory, cleanup } = temporaryDirectory('researchforge-bootstrap-');
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
    cleanup();
  }
});
