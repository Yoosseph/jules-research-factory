import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { openStore } from '../src/db.mjs';
import { createApp } from '../src/app.mjs';

test('setup, reserve, preflight, launch and PR validation use one verified destination', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'researchforge-workflow-'));
  const store = openStore(directory);
  const calls = [];
  const promptPath = join(directory, 'prompt-template.txt');
  writeFileSync(promptPath, readFileSync(new URL('../prompt-template.txt', import.meta.url)));
  let sessionPolls = 0;
  let forcedSessionState = null;
  let autoQuestion = false;
  let autoPlan = false;
  const responses = [];
  const source = { name: 'sources/actual-provider-id', githubRepo: { owner: 'example-owner', repo: 'example-research-repo', branches: [{ displayName: 'main' }] } };
  const jules = {
    sources: async () => [source], source: async () => source,
    createSession: async args => { calls.push(args); return { name: `sessions/${calls.length}`, url: `https://jules.google.com/session/${calls.length}` }; },
    session: async () => forcedSessionState ? { state: forcedSessionState } : (++sessionPolls === 1 ? { state: 'IN_PROGRESS' } : { state: 'COMPLETED', outputs: [{ pullRequest: { url: 'https://github.com/example-owner/example-research-repo/pull/7' } }] }),
    approvePlan: async name => { responses.push({ action: 'approve', name }); return {}; },
    sendMessage: async (name, prompt) => { responses.push({ action: 'reply', name, prompt }); return {}; },
    activities: async () => [
      { name: 'sessions/1/activities/plan', originator: 'agent', createTime: '2026-01-01T00:00:00Z', planGenerated: { plan: { steps: [{ index: 0, title: 'Design experiment', description: 'Select baselines' }] } } },
      { name: 'sessions/1/activities/progress', originator: 'agent', createTime: '2026-01-01T00:01:00Z', progressUpdated: { title: 'Running experiments', description: '<script>alert(1)</script>' } },
      ...(autoPlan ? [{ name: 'sessions/1/activities/plan-two', originator: 'agent', createTime: '2026-01-01T00:02:00Z', planGenerated: { plan: { steps: [{ index: 0, title: 'Run final experiments' }] } } }] : []),
      ...(autoQuestion ? [{ name: 'sessions/1/activities/question', originator: 'agent', createTime: '2026-01-01T00:03:00Z', agentMessaged: { agentMessage: 'Which dataset should I use?' } }] : [])
    ]
  };
  const github = {
    user: async () => ({ login: 'tester' }),
    repo: async () => ({ id: 31415, full_name: 'example-owner/example-research-repo', owner: { login: 'example-owner' }, name: 'example-research-repo' }),
    branch: async () => ({ commit: { sha: 'abc' } }),
    commit: async () => ({ tree: { sha: 'root-tree' } }),
    tree: async () => ({ tree: [{ path: '1-OpenFE', type: 'tree' }, { path: '4-Concept-Drift', type: 'tree' }] }),
    pulls: async () => [],
    pull: async () => ({ base: { repo: { id: 31415 }, ref: 'main' } }),
    pullFiles: async () => [{ filename: '5-Uncertainty-Estimation/README.md' }]
  };
  const app = createApp(store, { julesFactory: () => jules, githubFactory: () => github, promptPath });
  await new Promise(resolveReady => app.server.listen(0, '127.0.0.1', resolveReady));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const get = path => fetch(`${base}${path}`, { redirect: 'manual' });
  const post = (path, values) => fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: new URLSearchParams(values) });
  try {
    const setupResponse = await get('/setup');
    const page = await setupResponse.text();
    assert.match(page, /<style>[\s\S]*\.setup\s*\{/);
    assert.doesNotMatch(page, /<link rel="stylesheet"/);
    assert.match(setupResponse.headers.get('content-security-policy'), /style-src 'sha256-[^']+'/);
    const token = page.match(/name="csrf" value="([^"]+)"/)[1];
    const alternateLoopback = await fetch(`${base}/setup/jules`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://localhost:${app.server.address().port}` },
      body: new URLSearchParams({ csrf: token, julesKey: 'secret-jules' })
    });
    assert.equal(alternateLoopback.status, 303);
    assert.equal((await post('/setup/jules', { csrf: token, julesKey: 'secret-jules' })).status, 303);
    const unusualOrigin = await fetch(`${base}/setup/jules`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'null' },
      body: new URLSearchParams({ csrf: token, julesKey: 'secret-jules' })
    });
    assert.equal(unusualOrigin.status, 303);
    const foreignOriginWithoutToken = await fetch(`${base}/setup/jules`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://example.com' },
      body: new URLSearchParams({ csrf: 'invalid', julesKey: 'secret-jules' })
    });
    assert.equal(foreignOriginWithoutToken.status, 403);
    assert.equal(await foreignOriginWithoutToken.text(), 'Invalid form token');
    assert.equal((await post('/setup/repository', { csrf: token, sourceName: source.name, branch: 'main', githubToken: 'secret-github' })).status, 303);
    assert.equal(store.binding().jules_source_id, source.name);
    assert.equal((await post('/setup/defaults', { csrf: token, runtime: '30–60', developmentSeeds: 5, finalSeeds: 10, concurrency: 1 })).status, 303);
    const editedPrompt = `Research {{topic}} in {{repository}} on {{branch}}. Create every file inside {{folder}}/ and report outcomes clearly. Use {{development_seeds}} development seeds and {{final_seeds}} final seeds. <script>alert(1)</script>`;
    assert.equal((await post('/prompt', { csrf: token, promptTemplate: editedPrompt })).status, 303);
    assert.equal(readFileSync(promptPath, 'utf8').trim(), editedPrompt);
    assert.equal((await post('/projects/reserve', { csrf: token, topics: 'Discard this topic' })).status, 303);
    const disposable = store.projects()[0];
    assert.match(await (await get('/')).text(), /Remove reservation/);
    assert.equal((await post('/projects/remove', { csrf: token, projectId: disposable.id })).status, 303);
    assert.equal(store.project(disposable.id), undefined);
    const reserve = await post('/projects/reserve', { csrf: token, topics: 'Uncertainty Estimation' });
    assert.equal(reserve.status, 303);
    const preflightPath = reserve.headers.get('location');
    const preflight = await (await get(preflightPath)).text();
    assert.match(preflight, /example-owner\/example-research-repo/);
    assert.match(preflight, /5-Uncertainty-Estimation/);
    assert.match(preflight, /Launch 1 Jules task/);
    assert.match(preflight, /Prompt for 5-Uncertainty-Estimation/);
    const project = store.projects()[0];
    const dashboardBeforeLaunch = await (await get('/')).text();
    assert.match(dashboardBeforeLaunch, new RegExp(`/preflight\\?id=${project.id}`));
    assert.match(dashboardBeforeLaunch, /Review &amp; launch/);
    assert.match(await (await get(`/preflight?id=${project.id}`)).text(), /Launch 1 Jules task/);
    assert.equal((await post('/projects/launch', { csrf: token, projectId: project.id })).status, 303);
    for (let attempt = 0; attempt < 50 && store.project(project.id).status !== 'running'; attempt++) await new Promise(resolveWait => setTimeout(resolveWait, 10));
    assert.equal(store.project(project.id).status, 'running');
    assert.doesNotMatch(await (await get('/')).text(), /Review &amp; launch/);
    assert.equal((await post('/projects/remove', { csrf: token, projectId: project.id })).status, 303);
    assert.equal(store.project(project.id).status, 'running');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sourceName, source.name);
    assert.equal(calls[0].branch, 'main');
    assert.match(calls[0].prompt, /5-Uncertainty-Estimation\//);
    assert.match(calls[0].prompt, /<script>alert\(1\)<\/script>/);
    store.set('autoReply', '0');
    forcedSessionState = 'AWAITING_PLAN_APPROVAL';
    await app.pollSessions();
    assert.match(await (await get(`/projects/${project.id}`)).text(), /Approve plan and continue/);
    const approve = await post(`/projects/${project.id}/approve-plan`, { csrf: token });
    assert.equal(approve.status, 303);
    assert.deepEqual(responses[0], { action: 'approve', name: 'sessions/1' });
    forcedSessionState = 'AWAITING_USER_FEEDBACK';
    await app.pollSessions();
    const feedbackPage = await (await get(`/projects/${project.id}`)).text();
    assert.match(feedbackPage, /Jules needs your answer/);
    assert.match(feedbackPage, /Send reply to Jules/);
    assert.doesNotMatch(feedbackPage, /http-equiv="refresh"/);
    const reply = await post(`/projects/${project.id}/reply`, { csrf: token, reply: 'Please continue with the baseline.' });
    assert.equal(reply.status, 303);
    assert.deepEqual(responses[1], { action: 'reply', name: 'sessions/1', prompt: 'Please continue with the baseline.' });
    store.set('autoReply', '1');
    autoPlan = true;
    forcedSessionState = 'AWAITING_PLAN_APPROVAL';
    await app.pollSessions();
    assert.deepEqual(responses[2], { action: 'approve', name: 'sessions/1' });
    await app.pollSessions();
    assert.equal(responses.length, 3);
    autoQuestion = true;
    forcedSessionState = 'AWAITING_USER_FEEDBACK';
    await app.pollSessions();
    assert.equal(responses[3].action, 'reply');
    assert.match(responses[3].prompt, /continue without waiting for me/);
    assert.match(await (await get(`/projects/${project.id}`)).text(), /Research Facility answered Jules/);
    await app.pollSessions();
    assert.equal(responses.length, 4);
    forcedSessionState = null;
    await app.pollSessions();
    assert.equal(store.project(project.id).jules_state, 'IN_PROGRESS');
    const staleReply = await post(`/projects/${project.id}/reply`, { csrf: token, reply: 'Send again' });
    assert.match(staleReply.headers.get('location'), /\/projects\/[^?]+\?error=/);
    assert.equal(responses.length, 4);
    const board = await (await get('/activity')).text();
    assert.match(board, /Which dataset should I use\?/);
    assert.match(board, /Jules agents/);
    assert.match(board, /href="\/activity\/settings">Agent settings/);
    assert.match(board, /Concurrency limit<\/span><strong>1/);
    const detail = await (await get(`/projects/${project.id}`)).text();
    assert.match(detail, /Design experiment/);
    assert.match(detail, /Exact prompt sent to Jules/);
    assert.doesNotMatch(detail, /<script>alert\(1\)<\/script>/);
    assert.match(detail, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    await app.pollSessions();
    assert.equal(store.project(project.id).status, 'pr_validated');
    assert.equal(store.activities(project.id).length, 4);
    const settingsBefore = await (await get('/activity/settings')).text();
    assert.match(settingsBefore, /name="concurrency"[^>]*value="1"/);
    assert.match(settingsBefore, /name="runtime"/);
    assert.match(settingsBefore, /name="developmentSeeds"/);
    assert.match(settingsBefore, /name="finalSeeds"/);
    assert.match(settingsBefore, /name="autoReply"[^>]*checked/);
    assert.equal((await post('/activity/settings', { csrf: token, runtime: '30–60', developmentSeeds: 5, finalSeeds: 10, concurrency: 1, autoReplyPresent: 1 })).status, 303);
    assert.equal(store.get('autoReply'), '0');
    assert.equal((await post('/activity/settings', { csrf: token, runtime: '30–60', developmentSeeds: 5, finalSeeds: 10, concurrency: 1, autoReplyPresent: 1, autoReply: 1 })).status, 303);
    assert.equal(store.get('autoReply'), '1');
    assert.equal((await post('/projects/reserve', { csrf: token, topics: 'Second Study\nThird Study' })).status, 303);
    const nextProjects = store.projects().filter(item => ['Second Study', 'Third Study'].includes(item.topic));
    const launchTwo = await fetch(`${base}/projects/launch`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: new URLSearchParams([['csrf', token], ...nextProjects.map(item => ['projectId', item.id])]) });
    assert.equal(launchTwo.status, 303);
    for (let attempt = 0; attempt < 50 && nextProjects.filter(item => store.project(item.id).status === 'running').length !== 1; attempt++) await new Promise(resolveWait => setTimeout(resolveWait, 10));
    assert.equal(nextProjects.filter(item => store.project(item.id).status === 'running').length, 1);
    assert.equal(nextProjects.filter(item => store.project(item.id).status === 'queued').length, 1);
    assert.equal((await post('/activity/settings', { csrf: token, runtime: '60–120', developmentSeeds: 3, finalSeeds: 7, concurrency: 2 })).status, 303);
    for (let attempt = 0; attempt < 50 && nextProjects.some(item => store.project(item.id).status !== 'running'); attempt++) await new Promise(resolveWait => setTimeout(resolveWait, 10));
    assert.ok(nextProjects.every(item => store.project(item.id).status === 'running'));
    assert.equal(store.get('concurrency'), '2');
    assert.equal(store.get('runtime'), '60–120');
    assert.equal(store.get('developmentSeeds'), '3');
    assert.equal(store.get('finalSeeds'), '7');
    assert.match(await (await get('/activity')).text(), /Concurrency limit<\/span><strong>2/);
    assert.match(await (await get('/activity/settings')).text(), /name="concurrency"[^>]*value="2"/);
    const invalidSettings = await post('/activity/settings', { csrf: token, runtime: '60–120', developmentSeeds: 3, finalSeeds: 7, concurrency: 51 });
    assert.equal(invalidSettings.status, 303);
    assert.match(invalidSettings.headers.get('location'), /\/activity\/settings\?error=/);
    assert.equal(store.get('concurrency'), '2');
  } finally {
    await new Promise(resolveClose => app.server.close(resolveClose));
    store.db.close();
    if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) rmSync(directory, { recursive: true, force: true });
  }
});
