import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, reliabilityFixture } from './support/reliability.mjs';
import { createAutoReplies } from '../src/auto-replies.mjs';
import { orchestratorClient } from '../src/orchestrator.mjs';
import { ProviderError, retryAfterMs } from '../src/providers.mjs';
import { validatePullRequest } from '../src/core.mjs';

test('stopping a queued task during verification prevents creation and preserves stopped status on errors', async () => {
  for (const fail of [false, true]) {
    const f = await reliabilityFixture();
    const begun = deferred(), gate = deferred();
    try {
      const [p] = f.store.reserve(['Stop during verification']);
      f.store.db.prepare("UPDATE projects SET status='queued' WHERE id=?").run(p.id);
      f.github.tree = async () => { begun.resolve(); await gate.promise; if (fail) throw new Error('Verification failed'); return { tree: [] }; };
      const launch = f.coordinator.launchResearchProject(p.id);
      await begun.promise;
      const response = await f.request(`/projects/${p.id}/stop`, {});
      assert.match(response.headers.location, /Task%20stopped/);
      gate.resolve(); await launch;
      assert.equal(f.store.project(p.id).status, 'stopped');
      assert.equal(f.sessions.size, 0);
    } finally { gate.resolve(); await f.cleanup(); }
  }
});

test('concurrent launch attempts create only one remote session', async () => {
  const f = await reliabilityFixture();
  try {
    const [p] = f.store.reserve(['One session']);
    f.store.db.prepare("UPDATE projects SET status='queued' WHERE id=?").run(p.id);
    await Promise.all([f.coordinator.launchResearchProject(p.id), f.coordinator.launchResearchProject(p.id)]);
    assert.equal(f.sessions.size, 1);
    assert.equal(f.store.project(p.id).status, 'running');
  } finally { await f.cleanup(); }
});

test('an in-flight completion poll cannot overwrite a stopped task', async () => {
  const f = await reliabilityFixture();
  const begun = deferred(), gate = deferred();
  try {
    const [p] = f.store.reserve(['Stop during activities']);
    f.store.db.prepare("UPDATE projects SET status='running',jules_session_name='sessions/one' WHERE id=?").run(p.id);
    f.sessions.set('sessions/one', { name: 'sessions/one', state: 'COMPLETED' });
    f.jules.activities = async () => { begun.resolve(); await gate.promise; return []; };
    const poll = f.coordinator.pollSessions();
    await begun.promise;
    await f.request(`/projects/${p.id}/stop`, {});
    gate.resolve(); await poll;
    assert.equal(f.store.project(p.id).status, 'stopped');
    assert.equal(f.store.project(p.id).jules_state, 'STOPPED');
  } finally { gate.resolve(); await f.cleanup(); }
});

test('pending remote deletion prevents polling from completing the task and restores it on definite failure', async () => {
  const f = await reliabilityFixture();
  const begun = deferred(), gate = deferred();
  try {
    const [p] = f.store.reserve(['Stop while remote deletion is pending']);
    f.store.db.prepare("UPDATE projects SET status='running',jules_session_name='sessions/one' WHERE id=?").run(p.id);
    f.sessions.set('sessions/one', { name: 'sessions/one', state: 'COMPLETED' });
    f.jules.deleteSession = async () => { begun.resolve(); await gate.promise; };
    const stopping = f.request(`/projects/${p.id}/stop`, {});
    await begun.promise;
    assert.equal(f.store.project(p.id).status, 'stopping');
    assert.throws(() => f.store.setNextProjectNumber(1), /finish or stop/);
    await f.coordinator.pollSessions();
    assert.equal(f.store.project(p.id).status, 'stopping');
    gate.resolve(); await stopping;
    assert.equal(f.store.project(p.id).status, 'stopped');
    f.store.db.prepare("UPDATE projects SET status='running' WHERE id=?").run(p.id);
    f.jules.deleteSession = async () => { throw new ProviderError('Jules', 403, 'Denied'); };
    const failed = await f.request(`/projects/${p.id}/stop`, {});
    assert.match(failed.headers.location, /error=/);
    assert.equal(f.store.project(p.id).status, 'running');
  } finally { gate.resolve(); await f.cleanup(); }
});

test('pending model replies respect disabled replies, stopped projects and shutdown', async () => {
  for (const change of ['disable', 'stop', 'close']) {
    const f = await reliabilityFixture();
    const begun = deferred(), gate = deferred();
    let closed = false;
    try {
      const [p] = f.store.reserve(['Reply policy']);
      f.store.db.prepare("UPDATE projects SET status='running',jules_session_name='sessions/one' WHERE id=?").run(p.id);
      f.store.setSecret('orchestrator', 'fake-model');
      const auto = createAutoReplies(f.store, { continuous: () => false, isClosed: () => closed,
        orchestratorSettings: () => ({ brief: 'Public market research' }),
        modelClient: () => async () => { begun.resolve(); await gate.promise; return { reply: 'Use public sources.' }; } });
      const project = f.store.project(p.id);
      const activities = [{ name: 'sessions/one/activities/question', agentMessaged: { agentMessage: 'Which source?' } }];
      const reply = auto.autoReplyToFeedback(project, f.jules, activities);
      await begun.promise;
      if (change === 'disable') f.store.set('autoReply', '0');
      if (change === 'stop') f.store.db.prepare("UPDATE projects SET status='stopped' WHERE id=?").run(p.id);
      if (change === 'close') closed = true;
      gate.resolve(); await reply;
      assert.equal(f.sent.length, 0);
      assert.equal(f.store.autoReplies(p.id).length, 0);
      if (change === 'disable') {
        f.store.set('autoReply', '1');
        await auto.autoReplyToFeedback(project, f.jules, activities);
        assert.equal(f.sent.length, 1, 'an unsent answer remains eligible after re-enabling');
      }
    } finally { gate.resolve(); await f.cleanup(); }
  }
});

test('report checks persist their cadence and cache files only while both commits are unchanged', async () => {
  const f = await reliabilityFixture();
  try {
    const [p] = f.store.reserve(['Cached report']);
    f.store.db.prepare("UPDATE projects SET status='pr_validated',pr_status='open',pr_url='https://github.com/owner/repo/pull/1' WHERE id=?").run(p.id);
    let head = 'head-1', base = 'base-1', state = 'open', invalid = false, pullCalls = 0, fileCalls = 0;
    f.github.pull = async () => { pullCalls++; return { head: { sha: head }, base: { sha: base, ref: 'main', repo: { id: 7 } }, changed_files: 1, state }; };
    f.github.pullFiles = async () => { fileCalls++; return [{ filename: invalid ? 'outside.md' : `${p.folder}/report.md` }]; };
    const due = () => f.store.db.prepare("UPDATE projects SET pr_checked_at='2000-01-01T00:00:00Z' WHERE id=?").run(p.id);
    await f.coordinator.pollSessions();
    await f.coordinator.pollSessions();
    assert.equal(pullCalls, 2); assert.equal(fileCalls, 1);
    due(); await f.coordinator.pollSessions();
    assert.equal(pullCalls, 3); assert.equal(fileCalls, 1);
    head = 'head-2'; due(); await f.coordinator.pollSessions();
    assert.equal(fileCalls, 2);
    base = 'base-2'; due(); await f.coordinator.pollSessions();
    assert.equal(fileCalls, 3);
    state = 'closed'; due(); await f.coordinator.pollSessions();
    const count = pullCalls;
    f.store.db.prepare('UPDATE projects SET pr_checked_at=? WHERE id=?').run(new Date(Date.now() - 3600000).toISOString(), p.id);
    await f.coordinator.pollSessions(); assert.equal(pullCalls, count);
    invalid = true;
    const response = await f.request(`/projects/${p.id}/refresh-report`, {});
    assert.match(response.headers.location, /error=/);
    assert.equal(f.store.project(p.id).status, 'pr_rejected', 'manual refresh bypasses cached files');
  } finally { await f.cleanup(); }
});

test('GitHub outages are throttled and report checking batches remain bounded', async () => {
  const f = await reliabilityFixture();
  try {
    const projects = f.store.reserve(Array.from({ length: 12 }, (_, i) => `Report ${i}`));
    for (const p of projects) f.store.db.prepare("UPDATE projects SET status='pr_validated',pr_url='https://github.com/owner/repo/pull/1' WHERE id=?").run(p.id);
    let calls = 0;
    f.github.pull = async () => { calls++; throw new Error('Unavailable'); };
    await f.coordinator.pollSessions(); assert.equal(calls, 10);
    await f.coordinator.pollSessions(); assert.equal(calls, 12);
    await f.coordinator.pollSessions(); assert.equal(calls, 12);
    assert.ok(projects.every(p => f.store.project(p.id).pr_checked_at));
  } finally { await f.cleanup(); }
});

test('validation refuses to cache a report whose commits changed while fetching file pages', async () => {
  const f = await reliabilityFixture();
  try {
    const [p] = f.store.reserve(['Mutable report']);
    let head = 'before';
    f.github.pull = async () => ({ head: { sha: head }, base: { sha: 'base', ref: 'main', repo: { id: 7 } }, changed_files: 1 });
    f.github.pullFiles = async () => { head = 'after'; return [{ filename: `${p.folder}/report.md` }]; };
    await assert.rejects(validatePullRequest('https://github.com/owner/repo/pull/1', p, f.store.binding(), f.github), /changed during validation/);
  } finally { await f.cleanup(); }
});

test('model errors retain retry timing even when the error response is not JSON', async () => {
  const endpoint = 'https://example.invalid/chat';
  for (const invalidJson of [false, true]) {
    const client = orchestratorClient({ endpoint, model: 'fake', apiKey: 'fake' }, async () => ({
      ok: false, status: 429, statusText: 'Too Many Requests', headers: new Headers({ 'retry-after': '7200' }),
      json: async () => { if (invalidJson) throw new Error('HTML error page'); return { error: { status: 'RESOURCE_EXHAUSTED' } }; }
    }));
    await assert.rejects(client('system', 'user'), error => error instanceof ProviderError && error.status === 429 && error.retryAfterMs === 7200000);
  }
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(retryAfterMs({ headers: new Headers({ 'retry-after': 'Thu, 01 Jan 2026 02:00:00 GMT' }) }, now), 7200000);
  assert.equal(retryAfterMs({ headers: new Headers({ 'retry-after': 'invalid' }) }, now), 0);
});

test('model reply rate limits persist a cooldown and subsequent questions use the standing policy', async () => {
  const f = await reliabilityFixture();
  try {
    const [p] = f.store.reserve(['Reply cooldown']);
    f.store.db.prepare("UPDATE projects SET status='running',jules_session_name='sessions/replies' WHERE id=?").run(p.id);
    f.sessions.set('sessions/replies', { name: 'sessions/replies', state: 'AWAITING_USER_FEEDBACK' });
    f.store.setSecret('orchestrator', 'fake-model'); f.store.set('orchestrator', JSON.stringify({ brief: 'Public sources', enabled: false }));
    let calls = 0, questions = 0;
    f.setModel(async () => { calls++; throw new ProviderError('Model', 429, 'Wait two hours', { retryAfterMs: 7200000 }); });
    f.jules.activities = async () => [{ name: `sessions/replies/activities/question-${++questions}`, originator: 'agent', agentMessaged: { agentMessage: 'Which public source?' } }];
    await f.coordinator.pollSessions();
    assert.ok(Date.parse(f.store.get('orchestratorRetryAt')) - Date.now() > 7199000);
    await f.coordinator.pollSessions();
    assert.equal(calls, 1); assert.equal(f.sent.length, 2);
    assert.ok(f.sent.every(message => message.reply.includes('Please continue without waiting')));
  } finally { await f.cleanup(); }
});

test('recovery reconnects the original session and refuses mismatched or duplicate retries', async () => {
  const f = await reliabilityFixture();
  try {
    const [p] = f.store.reserve(['Interrupted launch']);
    f.store.db.prepare("UPDATE projects SET status='blocked',prompt_text='Saved original prompt' WHERE id=?").run(p.id);
    const session = { name: 'sessions/existing', state: 'IN_PROGRESS', prompt: 'Saved original prompt',
      sourceContext: { source: 'sources/repo', githubRepoContext: { startingBranch: 'main' } } };
    f.sessions.set(session.name, session);
    const page = await f.request(`/projects/${p.id}/recovery`);
    assert.equal(page.status, 200); assert.match(page.body, /Reconnect this session/);
    assert.doesNotMatch(page.body, /Return to launch review/);
    await assert.rejects(f.coordinator.recoverProject(p.id, { action: 'retry', noSession: true }), /matching session/);
    f.sessions.set('sessions/wrong', { ...session, name: 'sessions/wrong', sourceContext: { source: 'sources/other' } });
    await assert.rejects(f.coordinator.recoverProject(p.id, { action: 'attach', sessionName: 'sessions/wrong' }), /does not match/);
    const response = await f.request(`/projects/${p.id}/recovery`, { action: 'attach', sessionName: session.name });
    assert.equal(response.status, 303);
    assert.equal(f.store.project(p.id).jules_session_name, session.name);
    assert.equal(f.store.project(p.id).status, 'running');
    assert.equal(f.sessions.size, 2, 'reconnecting creates no new session');
  } finally { await f.cleanup(); }
});

test('retrying a blocked launch requires inspection, checks collisions, and returns to preflight without launching', async () => {
  const f = await reliabilityFixture();
  try {
    const [p] = f.store.reserve(['Safe retry']);
    f.store.db.prepare("UPDATE projects SET status='blocked',prompt_text='Saved prompt' WHERE id=?").run(p.id);
    await assert.rejects(f.coordinator.recoverProject(p.id, { action: 'retry' }), /confirm/);
    f.github.tree = async () => ({ tree: [{ path: p.folder, type: 'tree' }] });
    await assert.rejects(f.coordinator.recoverProject(p.id, { action: 'retry', noSession: true }), /conflicts/);
    f.github.tree = async () => ({ tree: [] });
    const response = await f.request(`/projects/${p.id}/recovery`, { action: 'retry', noSession: '1' });
    assert.match(response.headers.location, /^\/preflight\?id=/);
    assert.equal(f.store.project(p.id).status, 'reserved');
    assert.equal(f.sessions.size, 0);
  } finally { await f.cleanup(); }
});

test('history pages bound returned records, preserve totals and show the current question on older timeline pages', async () => {
  const f = await reliabilityFixture();
  try {
    f.store.set('configured', '1');
    const projects = f.store.reserve(Array.from({ length: 61 }, (_, i) => `History ${i}`));
    const p = projects.at(-1);
    f.store.db.prepare("UPDATE projects SET status='running',jules_state='AWAITING_USER_FEEDBACK',jules_session_name='sessions/history' WHERE id=?").run(p.id);
    for (let i = 0; i < 61; i++) f.store.db.prepare('INSERT INTO jules_activities VALUES (?,?,?,?,?,?,?)')
      .run(`sessions/history/activities/${i}`, p.id, 'message', 'agent', 'Jules message', `Question ${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString());
    const first = f.store.projectHistory(1), second = f.store.projectHistory(2);
    assert.equal(first.items.length, 25); assert.equal(second.items.length, 25); assert.equal(first.total, 61);
    assert.equal(new Set([...first.items, ...second.items].map(p => p.id)).size, 50);
    assert.equal(f.store.projectHistory('invalid').page, 1); assert.equal(f.store.projectHistory(999).page, 3);
    const dashboard = (await f.request('/?page=2')).body;
    assert.match(dashboard, /61 local projects/); assert.match(dashboard, /Clear reserved \(60\)/);
    assert.match(dashboard, /Page 2 of 3/);
    const activity = (await f.request('/activity?page=2')).body;
    assert.match(activity, /Active or queued<\/span><strong>1/); assert.match(activity, /Page 2 of 3/);
    const detail = (await f.request(`/projects/${p.id}?page=3`)).body;
    assert.equal((detail.match(/class="timeline-item"/g) || []).length, 11);
    assert.match(detail, /agent-question">Question 60/);
    assert.match(detail, /Page 3 of 3/);
    f.store.projects = () => { throw new Error('The live view must not load the entire project library'); };
    assert.equal(f.coordinator.snapshot().active, 1);
  } finally { await f.cleanup(); }
});
