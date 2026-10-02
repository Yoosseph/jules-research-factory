import test from 'node:test';
import assert from 'node:assert/strict';
import { julesClient, ProviderError } from '../src/providers.mjs';

test('account sessions are paginated and repeated tokens are rejected', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return { ok: true, json: async () => urls.length === 1
      ? { sessions: [{ name: 'sessions/one', state: 'IN_PROGRESS' }], nextPageToken: 'next' }
      : { sessions: [{ name: 'sessions/two', state: 'COMPLETED' }] } };
  };
  try {
    assert.equal((await julesClient('test-key').sessions()).length, 2);
    assert.match(urls[1], /sessions\?pageSize=100&pageToken=next/);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ sessions: [], nextPageToken: 'same' }) });
    await assert.rejects(julesClient('test-key').sessions(), /repeated a session page/);
  } finally { globalThis.fetch = originalFetch; }
});

test('provider quota errors retain retry-after and structured status', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '600' }), json: async () => ({ error: { message: 'Daily quota exhausted', status: 'RESOURCE_EXHAUSTED' } }) });
  try {
    await assert.rejects(julesClient('test-key').sessions(), error => error instanceof ProviderError && error.retryAfterMs === 600000 && error.code === 'RESOURCE_EXHAUSTED');
  } finally { globalThis.fetch = originalFetch; }
});

test('Jules activities are fetched across pages for a session', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    const page = urls.length === 1
      ? { activities: [{ name: 'sessions/abc/activities/one' }], nextPageToken: 'next' }
      : { activities: [{ name: 'sessions/abc/activities/two' }] };
    return { ok: true, json: async () => page };
  };
  try {
    const activities = await julesClient('test-key').activities('sessions/abc');
    assert.deepEqual(activities.map(item => item.name), ['sessions/abc/activities/one', 'sessions/abc/activities/two']);
    assert.match(urls[0], /sessions\/abc\/activities\?pageSize=100/);
    assert.match(urls[1], /pageToken=next/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Jules sessions auto-approve plans and can receive feedback', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ name: 'sessions/abc' }) };
  };
  try {
    const jules = julesClient('test-key');
    await jules.createSession({ prompt: 'Research topic', title: 'Topic', sourceName: 'sources/repo', branch: 'main' });
    await jules.approvePlan('sessions/abc');
    await jules.sendMessage('sessions/abc', 'Use the smaller dataset.');
    assert.equal(requests[0].body.requirePlanApproval, false);
    assert.equal(requests[0].body.automationMode, 'AUTO_CREATE_PR');
    assert.match(requests[1].url, /sessions\/abc:approvePlan$/);
    assert.match(requests[2].url, /sessions\/abc:sendMessage$/);
    assert.equal(requests[2].body.prompt, 'Use the smaller dataset.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
