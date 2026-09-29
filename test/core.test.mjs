import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { openStore } from '../src/db.mjs';
import { verifyRepository, verifyReservations, verifyProjectBinding, validatePullRequest, researchPrompt } from '../src/core.mjs';

function storeForTest() {
  const directory = mkdtempSync(join(tmpdir(), 'researchforge-test-'));
  const store = openStore(directory);
  return { store, cleanup() { store.db.close(); if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) rmSync(directory, { recursive: true, force: true }); } };
}

const source = { name: 'sources/authoritative-123', githubRepo: { owner: 'example-owner', repo: 'example-research-repo', branches: [{ displayName: 'main' }] } };
const github = {
  user: async () => ({ login: 'tester' }),
  repo: async () => ({ id: 9876, full_name: 'example-owner/example-research-repo', owner: { login: 'example-owner' }, name: 'example-research-repo' }),
  branch: async () => ({ commit: { sha: 'abc123' } }),
  commit: async () => ({ tree: { sha: 'tree123' } }),
  branches: async () => [{ name: 'master' }, { name: 'develop' }],
  tree: async () => ({ truncated: false, tree: [{ path: '1-OpenFE', type: 'tree' }, { path: '4-Concept-Drift', type: 'tree' }, { path: 'readme.md', type: 'blob' }] }),
  pulls: async () => []
};
const jules = { sources: async () => [source], source: async () => source };
const input = { julesKey: 'jules-test', githubToken: 'github-test', owner: 'example-owner', repo: 'example-research-repo', branch: 'main' };

test('repository verification keeps the API source name and stable GitHub ID', async () => {
  const result = await verifyRepository(input, { jules, github });
  assert.equal(result.sourceName, 'sources/authoritative-123');
  assert.equal(result.githubId, '9876');
  assert.deepEqual(result.folders.map(folder => folder.number), [1, 4]);
  await assert.rejects(() => verifyRepository({ ...input, expectedGithubId: '9877' }, { jules, github }), /identity changed/);
  await assert.rejects(() => verifyRepository({ ...input, repo: 'other' }, { jules, github }), /Could not locate/);
});

test('missing main offers branches and never chooses one silently', async () => {
  const missingBranch = { ...github, branch: async () => { const error = new Error('missing'); error.status = 404; throw error; } };
  await assert.rejects(() => verifyRepository(input, { jules, github: missingBranch }), error => {
    assert.equal(error.details.code, 'BRANCH_MISSING');
    assert.deepEqual(error.details.branches, ['master', 'develop']);
    return true;
  });
});

test('private repository access failures identify the token setting to check', async () => {
  const inaccessibleRepo = { ...github, repo: async () => { const error = new Error('Not Found'); error.status = 404; throw error; } };
  await assert.rejects(() => verifyRepository(input, { jules, github: inaccessibleRepo }), /resource owner and selected repositories/);
  const inaccessiblePulls = { ...github, pulls: async () => { const error = new Error('Not Found'); error.status = 404; throw error; } };
  await assert.rejects(() => verifyRepository(input, { jules, github: inaccessiblePulls }), /Pull requests: read/);
});

test('folder numbers reserve atomically above gaps and local reservations', () => {
  const { store, cleanup } = storeForTest();
  try {
    store.saveBinding({ owner: 'example-owner', repo: 'example-research-repo', fullName: 'example-owner/example-research-repo', githubId: '9876', branch: 'main', sourceName: source.name });
    store.replaceRemoteFolders([{ name: '1-OpenFE', number: 1 }, { name: '4-Concept-Drift', number: 4 }, { name: '8-Missing-Data', number: 8 }]);
    const first = store.reserve(['Uncertainty Estimation', 'Robust Regression', 'Feature Selection']);
    assert.deepEqual(first.map(project => project.folder_number), [9, 10, 11]);
    assert.equal(store.reserve(['Calibration'])[0].folder_number, 12);
    assert.equal(new Set(store.projects().map(project => project.folder_number)).size, 4);
    verifyReservations(first, store.remoteFolders());
    verifyProjectBinding(first, store.binding());
    assert.match(researchPrompt(first[0], store.binding(), { runtime: '30–60', developmentSeeds: 5, finalSeeds: 10 }), /9-Uncertainty-Estimation\//);
    assert.throws(() => verifyReservations(first, [{ name: '9-Other', number: 9 }]), /conflicts/);
  } finally { cleanup(); }
});

test('PR validation rejects wrong base and files outside the assigned folder', async () => {
  const binding = { github_owner: 'example-owner', github_repo: 'example-research-repo', github_repository_id: '9876', base_branch: 'main' };
  const project = { folder: '9-Uncertainty-Estimation' };
  const good = { pull: async () => ({ base: { repo: { id: 9876 }, ref: 'main' } }), pullFiles: async () => [{ filename: '9-Uncertainty-Estimation/README.md' }] };
  assert.equal((await validatePullRequest('https://github.com/example-owner/example-research-repo/pull/12', project, binding, good)).number, 12);
  await assert.rejects(() => validatePullRequest('https://github.com/example-owner/other/pull/12', project, binding, good), /different repository/);
  await assert.rejects(() => validatePullRequest('https://github.com/example-owner/example-research-repo/pull/12', project, binding, { ...good, pullFiles: async () => [{ filename: 'README.md' }] }), /outside/);
  await assert.rejects(() => validatePullRequest('https://github.com/example-owner/example-research-repo/pull/12', project, binding, { ...good, pull: async () => ({ base: { repo: { id: 9876 }, ref: 'develop' } }) }), /base branch/);
});
