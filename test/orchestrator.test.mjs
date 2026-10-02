import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { openStore } from '../src/db.mjs';
import { createApp } from '../src/app.mjs';
import { NVIDIA_ENDPOINT, NVIDIA_MODEL, validateOrchestratorSettings, orchestratorClient, proposeResearch, draftJulesReply } from '../src/orchestrator.mjs';
import { ProviderError } from '../src/providers.mjs';

test('provider settings and structured responses reject invalid data', async () => {
  const settings = validateOrchestratorSettings({ provider: 'nvidia', endpoint: '', model: 'meta/llama-3.1-70b-instruct', brief: 'Study reliable forecasts', intervalHours: 6, dailyLimit: 3 });
  assert.equal(settings.endpoint, NVIDIA_ENDPOINT);
  assert.equal(validateOrchestratorSettings({ ...settings, mode: 'continuous', dailyLimit: 0 }).dailyLimit, 0);
  assert.throws(() => validateOrchestratorSettings({ ...settings, dailyLimit: -1 }), /daily limit/);
  assert.throws(() => validateOrchestratorSettings({ ...settings, mode: 'invalid' }), /continuous or scheduled/);
  assert.throws(() => validateOrchestratorSettings({ ...settings, provider: 'compatible', endpoint: 'http://example.com/v1/chat/completions' }), /HTTPS endpoint/);
  let request;
  const client = orchestratorClient({ endpoint: NVIDIA_ENDPOINT, model: NVIDIA_MODEL, apiKey: 'secret-key' }, async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '```json\n{"topic":"Forecast calibration","instructions":"Compare calibration methods."}\n```' } }] }) };
  });
  assert.deepEqual(await proposeResearch(client, { brief: settings.brief, repository: 'owner/repo', recentTopics: [] }), { topic: 'Forecast calibration', instructions: 'Compare calibration methods.' });
  assert.equal(request.options.headers.authorization, 'Bearer secret-key');
  assert.equal(JSON.parse(request.options.body).stream, false);
  assert.equal(JSON.parse(request.options.body).chat_template_kwargs.enable_thinking, false);
  const retired = orchestratorClient({ endpoint: NVIDIA_ENDPOINT, model: 'retired-model', apiKey: 'secret-key' }, async () => ({ ok: false, status: 410, statusText: 'Gone', json: async () => ({}) }));
  await assert.rejects(retired('system', 'user'), /retired-model is no longer available/);
  await assert.rejects(proposeResearch(async () => ({ topic: 'Forecast calibration', instructions: 'Again' }), { brief: settings.brief, repository: 'owner/repo', recentTopics: ['forecast calibration'] }), /repeated/);
  assert.equal(await draftJulesReply(async () => ({ reply: 'Use the public dataset and state its limitations.' }), { brief: settings.brief, topic: 'Forecast calibration', question: 'Which dataset?' }), 'Use the public dataset and state its limitations.');
});

async function continuousFixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'researchforge-continuous-'));
  const store = openStore(directory);
  const promptPath = join(directory, 'prompt.txt');
  writeFileSync(promptPath, readFileSync(new URL('../prompt-template.txt', import.meta.url)));
  store.setSecret('jules', 'jules-key');
  store.setSecret('github', 'github-token');
  store.setSecret('orchestrator', 'model-key');
  store.saveBinding({ owner: 'owner', repo: 'repo', fullName: 'owner/repo', githubId: '7', branch: 'main', sourceName: 'sources/repo' });
  store.set('configured', '1');
  store.set('concurrency', 2);
  const settings = { provider: 'nvidia', endpoint: NVIDIA_ENDPOINT, model: 'test-model', brief: 'Market analysis forever', intervalHours: 24, dailyLimit: 0, mode: 'continuous', enabled: false };
  store.set('orchestrator', JSON.stringify(settings));
  const source = { name: 'sources/repo', githubRepo: { owner: 'owner', repo: 'repo', branches: [{ displayName: 'main' }] } };
  const remote = new Map(), messages = [], plans = [], modelCalls = [];
  let attempts = 0, topics = 0;
  const jules = {
    sources: async () => [source], source: async () => source,
    sessions: async () => [...remote.values()],
    createSession: async () => {
      attempts++;
      const session = { name: `sessions/${attempts}`, state: 'IN_PROGRESS' };
      remote.set(session.name, session);
      return session;
    },
    session: async name => remote.get(name), activities: async () => [],
    sendMessage: async (name, message) => { messages.push({ name, message }); },
    approvePlan: async name => { plans.push(name); }
  };
  const github = {
    user: async () => ({}), repo: async () => ({ id: 7, full_name: 'owner/repo', owner: { login: 'owner' }, name: 'repo' }),
    branch: async () => ({ commit: { sha: 'abc' } }), commit: async () => ({ tree: { sha: 'tree' } }),
    tree: async () => ({ tree: [] }), pulls: async () => []
  };
  const options = { julesFactory: () => jules, githubFactory: () => github, promptPath, orchestratorFactory: () => async (system, user) => {
    modelCalls.push({ system, user });
    return system.includes('plan one research task') ? { topic: `Market study ${++topics}`, instructions: 'Compare competition and cite public sources.' } : { reply: 'Use public filings, state assumptions, and complete the report.' };
  } };
  const app = createApp(store, options);
  await app.pollSessions();
  settings.enabled = true;
  store.set('orchestrator', JSON.stringify(settings));
  const context = { app, store, settings, remote, jules, messages, plans, modelCalls, options, attempts: () => attempts };
  try { await run(context); }
  finally {
    settings.enabled = false;
    store.set('orchestrator', JSON.stringify(settings));
    await app.schedule();
    app.close();
    store.db.close();
    if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) rmSync(directory, { recursive: true, force: true });
  }
}

test('repository rebind clears the previous destination retry only after successful verification', async () => {
  await continuousFixture(async ({ app, store, settings, jules, options, attempts }) => {
    settings.enabled = false;
    settings.mode = 'scheduled';
    store.set('orchestrator', JSON.stringify(settings));
    const retryAt = '2099-01-01T00:00:00Z';
    store.set('orchestratorRetryAt', retryAt);
    store.set('orchestratorLastError', 'Could not locate owner/old-repo in Jules.');
    store.set('orchestratorFailures', 5);
    store.set('orchestratorLastAttempt', new Date().toISOString());
    await new Promise(done => app.server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const csrf = (await (await fetch(base + '/settings')).text()).match(/name="csrf" value="([^"]+)"/)[1];
    const post = values => fetch(base + '/setup/repository', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ csrf, rebind: '1', branch: 'main', ...values }) });
    await post({ owner: 'owner', repo: 'missing' });
    assert.equal(store.get('orchestratorRetryAt'), retryAt);
    assert.equal(store.binding().github_full_name, 'owner/repo');
    const source = { name: 'sources/new-repo', githubRepo: { owner: 'owner', repo: 'new-repo', branches: [{ displayName: 'main' }] } };
    jules.sources = async () => [source];
    jules.source = async () => source;
    options.githubFactory().repo = async () => ({ id: 8, full_name: 'owner/new-repo', owner: { login: 'owner' }, name: 'new-repo' });
    assert.equal((await post({ sourceName: source.name })).status, 303);
    assert.equal(store.binding().github_full_name, 'owner/new-repo');
    assert.equal(store.get('orchestratorRetryAt'), '');
    assert.equal(store.get('orchestratorLastError'), '');
    assert.equal(store.get('orchestratorFailures'), '0');
    assert.equal(store.get('orchestratorLastAttempt'), '');
    settings.enabled = true;
    store.set('orchestrator', JSON.stringify(settings));
    await app.runOrchestrator();
    assert.equal(attempts(), 1);
    assert.equal(store.projects()[0].repository_full_name, 'owner/new-repo');
  });
});

test('manual creation reports the actual retry cause without making another provider request', async () => {
  await continuousFixture(async ({ app, store, modelCalls, attempts }) => {
    store.set('orchestratorRetryAt', '2099-01-01T00:00:00Z');
    store.set('orchestratorLastError', 'Jules: quota retry pending');
    await assert.rejects(app.runOrchestrator(true), /Research is paused until .*Jules: quota retry pending/);
    assert.equal(modelCalls.length, 0);
    assert.equal(attempts(), 0);
  });
});

test('continuous research fills capacity, ignores reservations and hourly interval, and refills after completion', async () => {
  await continuousFixture(async ({ app, store, remote, modelCalls, attempts }) => {
    store.reserve(['An unlaunched manual topic']);
    store.set('orchestratorLastAttempt', new Date().toISOString());
    await Promise.all([app.runOrchestrator(), app.runOrchestrator(), app.schedule()]);
    assert.equal(attempts(), 2);
    assert.equal(store.projects().filter(item => item.status === 'running').length, 2);
    assert.equal(store.get('orchestratorCount'), '2');
    assert.match(store.projects().find(item => item.status === 'running').orchestrator_instructions, /do not ask the user questions/);
    await app.runOrchestrator();
    assert.equal(modelCalls.length, 2);
    remote.get('sessions/1').state = 'COMPLETED';
    await app.pollSessions();
    assert.equal(attempts(), 3);
    assert.equal(store.projects().filter(item => item.status === 'running').length, 2);
  });
});

test('continuous research refills a completed account slot before its activity poll finishes', async () => {
  await continuousFixture(async ({ app, store, remote, attempts }) => {
    await app.runOrchestrator();
    assert.equal(attempts(), 2);
    const first = store.projects().find(p => p.jules_session_name === 'sessions/1');
    remote.get('sessions/1').state = 'COMPLETED';
    assert.equal(store.project(first.id).status, 'running');
    await app.runOrchestrator();
    assert.equal(attempts(), 3);
    assert.equal([...remote.values()].filter(s => s.state === 'IN_PROGRESS').length, 2);
  });
});

test('account-wide Jules sessions occupy slots and a positive app cap still applies', async () => {
  await continuousFixture(async ({ app, store, remote, settings, attempts }) => {
    remote.set('sessions/external', { name: 'sessions/external', state: 'IN_PROGRESS' });
    settings.dailyLimit = 1;
    store.set('orchestrator', JSON.stringify(settings));
    await app.runOrchestrator();
    assert.equal(attempts(), 1);
    remote.get('sessions/external').state = 'COMPLETED';
    await app.runOrchestrator();
    assert.equal(attempts(), 1);
    store.set('orchestratorDay', '2000-01-01');
    await app.runOrchestrator();
    assert.equal(attempts(), 2);
  });
});

test('quota rejection backs off across restart and retries the same task without another proposal', async () => {
  await continuousFixture(async ({ app, store, jules, modelCalls, settings, options }) => {
    const create = jules.createSession;
    let rejected = 0;
    jules.createSession = async () => { rejected++; throw new ProviderError('Jules', 429, 'Jules: Quota exceeded', { retryAfterMs: 600000 }); };
    await app.runOrchestrator();
    const project = store.projects()[0];
    assert.equal(project.status, 'queued');
    assert.equal(store.get('orchestratorCount'), undefined);
    assert.ok(Date.parse(store.get('orchestratorRetryAt')) > Date.now() + 500000);
    await app.runOrchestrator();
    await app.schedule();
    assert.equal(rejected, 1);
    app.close();
    const restarted = createApp(store, options);
    try {
      await restarted.pollSessions();
      await restarted.runOrchestrator();
      assert.equal(rejected, 1);
      jules.createSession = create;
      store.set('orchestratorRetryAt', '2000-01-01T00:00:00Z');
      settings.dailyLimit = 1;
      store.set('orchestrator', JSON.stringify(settings));
      await restarted.pollSessions();
      assert.equal(store.project(project.id).status, 'running');
      assert.equal(store.projects().length, 1);
      assert.equal(modelCalls.length, 1);
      assert.equal(store.get('orchestratorCount'), '1');
    } finally { restarted.close(); }
  });
});

test('uncertain session creation is blocked and never automatically retried', async () => {
  await continuousFixture(async ({ app, store, jules }) => {
    let requests = 0;
    jules.createSession = async () => { requests++; throw new ProviderError('Jules', 503, 'Jules: Request timed out'); };
    await app.runOrchestrator();
    assert.equal(store.projects()[0].status, 'blocked');
    store.set('orchestratorRetryAt', '2000-01-01T00:00:00Z');
    await app.schedule();
    assert.equal(requests, 1);
    assert.equal(store.get('orchestratorCount'), undefined);
  });
});

test('invalid Jules credentials pause research before any model proposal or task creation', async () => {
  await continuousFixture(async ({ app, store, jules, modelCalls, attempts }) => {
    jules.sessions = async () => { throw new ProviderError('Jules', 401, 'Jules: Invalid API key or token'); };
    await app.runOrchestrator();
    assert.equal(modelCalls.length, 0);
    assert.equal(attempts(), 0);
    assert.equal(store.projects().length, 0);
    assert.match(store.get('orchestratorLastError'), /Invalid API key/);
    assert.ok(Date.parse(store.get('orchestratorRetryAt')) > Date.now() + 3500000);
  });
});

test('connection page verifies a replacement Jules key before saving and clears retry delay', async () => {
  await continuousFixture(async ({ app, store, jules, settings }) => {
    settings.enabled = false;
    store.set('orchestrator', JSON.stringify(settings));
    await new Promise(done => app.server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const page = await (await fetch(base + '/settings')).text();
    assert.match(page, /Update Jules key/);
    const csrf = page.match(/name="csrf" value="([^"]+)"/)[1];
    const post = key => fetch(base + '/settings/jules', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ csrf, julesKey: key }) });
    const sources = jules.sources;
    jules.sources = async () => { throw new ProviderError('Jules', 401, 'Jules: Invalid API key or token'); };
    assert.match((await post('invalid-replacement')).headers.get('location'), /error=/);
    assert.equal(store.getSecret('jules'), 'jules-key');
    jules.sources = sources;
    store.set('orchestratorRetryAt', '2099-01-01T00:00:00Z');
    assert.match((await post('valid-replacement')).headers.get('location'), /message=/);
    await app.schedule();
    assert.equal(store.getSecret('jules'), 'valid-replacement');
    assert.equal(store.get('orchestratorRetryAt'), '');
    assert.doesNotMatch(await (await fetch(base + '/settings')).text(), /valid-replacement/);
    const orchestrator = await (await fetch(base + '/orchestrator')).text();
    assert.match(orchestrator, /No app cap/);
    assert.match(orchestrator, /continuous" selected/);
    assert.match(orchestrator, /without the three-reply limit/);
  });
});

test('continuous research answers more than three distinct questions and plans without duplicate replies', async () => {
  await continuousFixture(async ({ app, store, jules, remote, messages, plans, modelCalls }) => {
    store.set('concurrency', 1);
    store.set('autoReply', '0');
    await app.runOrchestrator();
    const session = remote.get('sessions/1');
    for (let i = 1; i <= 5; i++) {
      session.state = 'AWAITING_USER_FEEDBACK';
      jules.activities = async () => [{ name: `sessions/1/activities/question-${i}`, originator: 'agent', createTime: `2026-10-02T12:00:0${i}Z`, agentMessaged: { agentMessage: 'Should I use paid data?' } }];
      await app.pollSessions();
      await app.pollSessions();
      assert.equal(messages.length, i);
      session.state = 'AWAITING_PLAN_APPROVAL';
      jules.activities = async () => [{ name: `sessions/1/activities/plan-${i}`, originator: 'agent', createTime: `2026-10-02T13:00:0${i}Z`, planGenerated: { plan: { steps: [] } } }];
      await app.pollSessions();
      await app.pollSessions();
      assert.equal(plans.length, i);
    }
    assert.equal(modelCalls.length, 6);
    assert.match(modelCalls[1].system, /Never ask the user questions/);
    assert.match(modelCalls[1].system, /accessible public sources/);
  });
});

test('disabling continuous research while the model responds prevents a launch', async () => {
  await continuousFixture(async ({ app, store, settings, options, attempts }) => {
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    options.orchestratorFactory = () => async () => {
      entered();
      await new Promise(resolve => { release = resolve; });
      return { topic: 'Delayed topic', instructions: 'Study markets' };
    };
    // Use a second app with the delayed client after closing the original scheduler.
    app.close();
    const delayed = createApp(store, options);
    try {
      await started;
      settings.enabled = false;
      store.set('orchestrator', JSON.stringify(settings));
      release();
      // The startup run owns the lock; wait until it releases it.
      for (let i = 0; i < 50 && !store.get('orchestratorLastError'); i++) await new Promise(done => setTimeout(done, 5));
      assert.equal(attempts(), 0);
      assert.equal(store.projects().length, 0);
    } finally { delayed.close(); }
  });
});

test('orchestrator settings create a checked Jules task and answer its question', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'researchforge-orchestrator-'));
  const store = openStore(directory);
  const promptPath = join(directory, 'prompt.txt');
  writeFileSync(promptPath, readFileSync(new URL('../prompt-template.txt', import.meta.url)));
  store.setSecret('jules', 'jules-key');
  store.setSecret('github', 'github-token');
  store.saveBinding({ owner: 'owner', repo: 'repo', fullName: 'owner/repo', githubId: '7', branch: 'main', sourceName: 'sources/repo' });
  store.set('configured', '1');
  const source = { name: 'sources/repo', githubRepo: { owner: 'owner', repo: 'repo', branches: [{ displayName: 'main' }] } };
  const sessions = [], messages = [], modelCalls = [];
  const jules = {
    sources: async () => [source], source: async () => source,
    createSession: async args => { sessions.push(args); return { name: 'sessions/one', state: 'IN_PROGRESS' }; },
    session: async () => ({ state: 'AWAITING_USER_FEEDBACK' }),
    activities: async () => [{ name: 'sessions/one/activities/question', originator: 'agent', createTime: '2026-09-30T12:00:00Z', agentMessaged: { agentMessage: 'Which baseline should I compare?' } }],
    sendMessage: async (_name, message) => { messages.push(message); }
  };
  const github = {
    user: async () => ({}), repo: async () => ({ id: 7, full_name: 'owner/repo', owner: { login: 'owner' }, name: 'repo' }),
    branch: async () => ({ commit: { sha: 'abc' } }), commit: async () => ({ tree: { sha: 'tree' } }),
    tree: async () => ({ tree: [] }), pulls: async () => []
  };
  const app = createApp(store, { julesFactory: () => jules, githubFactory: () => github, promptPath, orchestratorFactory: config => async (system, user) => {
    modelCalls.push({ config, user });
    if (system.includes('plan one research task')) return modelCalls.length === 1 ? { topic: 'Calibration study', instructions: 'Compare public calibration methods and cite sources.' } : { topic: 'Coverage study', instructions: 'Survey coverage measures and cite sources.' };
    return { reply: 'Compare against a simple published baseline and explain why.' };
  } });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const get = path => fetch(base + path);
  try {
    const page = await (await get('/orchestrator')).text();
    const csrf = page.match(/name="csrf" value="([^"]+)"/)[1];
    const post = (path, values) => fetch(base + path, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ csrf, ...values }) });
    assert.equal((await post('/orchestrator/settings', { provider: 'nvidia', model: 'meta/llama-3.1-70b-instruct', apiKey: 'nvidia-key', brief: 'Study trustworthy forecasts', intervalHours: 6, dailyLimit: 1 })).status, 303);
    assert.doesNotMatch(await (await get('/orchestrator')).text(), /nvidia-key/);
    assert.equal(store.getSecret('orchestrator'), 'nvidia-key');
    store.set('orchestratorDay', '2000-01-01');
    store.set('orchestratorCount', 20);
    assert.equal((await post('/orchestrator/generate', {})).status, 303);
    for (let i = 0; i < 50 && store.projects()[0]?.status !== 'running'; i++) await new Promise(done => setTimeout(done, 10));
    const project = store.projects()[0];
    assert.equal(project.status, 'running');
    assert.equal(project.topic, 'Calibration study');
    assert.match(project.orchestrator_instructions, /public calibration methods/);
    assert.match(sessions[0].prompt, /Task-specific research plan/);
    assert.match(sessions[0].prompt, /inside 1-Calibration-study\//);
    assert.equal(modelCalls[0].config.apiKey, 'nvidia-key');
    assert.equal(store.get('orchestratorCount'), '1');
    const capped = await post('/orchestrator/generate', {});
    assert.match(capped.headers.get('location'), /error=/);
    assert.equal(store.projects().length, 1);
    await app.pollSessions();
    assert.deepEqual(messages, ['Compare against a simple published baseline and explain why.']);
    await app.pollSessions();
    assert.equal(messages.length, 1);
    store.db.prepare("UPDATE projects SET status='completed' WHERE id=?").run(project.id);
    store.set('orchestratorLastAttempt', '2000-01-01T00:00:00.000Z');
    assert.equal((await post('/orchestrator/settings', { provider: 'nvidia', model: 'meta/llama-3.1-70b-instruct', brief: 'Study trustworthy forecasts', intervalHours: 6, dailyLimit: 2, enabled: 1 })).status, 303);
    for (let i = 0; i < 50 && store.projects().length < 2; i++) await new Promise(done => setTimeout(done, 10));
    assert.equal(store.projects().length, 2);
    assert.equal(store.projects()[0].topic, 'Coverage study');
    assert.equal(store.get('orchestratorCount'), '2');
  } finally {
    app.close();
    store.db.close();
    if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) rmSync(directory, { recursive: true, force: true });
  }
});
