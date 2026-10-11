import { Readable } from 'node:stream';
import { storeFixture, writePromptFixture } from './fixtures.mjs';
import { initializeFlow } from '../../src/flow.mjs';
import { createResearchCoordinator } from '../../src/research.mjs';
import { createRequestHandler } from '../../src/routes.mjs';

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export async function reliabilityFixture() {
  const fixture = storeFixture('research-reliability-');
  const { store, directory } = fixture;
  store.saveBinding({ owner: 'owner', repo: 'repo', fullName: 'owner/repo', githubId: '7', branch: 'main', sourceName: 'sources/repo' });
  store.setSecret('jules', 'fake-jules');
  store.setSecret('github', 'fake-github');
  initializeFlow(store);
  const source = { name: 'sources/repo', githubRepo: { owner: 'owner', repo: 'repo', branches: [{ displayName: 'main' }] } };
  const sessions = new Map();
  const sent = [];
  const jules = {
    sources: async () => [source], source: async () => source,
    sessions: async () => [...sessions.values()], session: async name => sessions.get(name),
    activities: async () => [], deleteSession: async name => { sessions.delete(name); },
    sendMessage: async (name, reply) => { sent.push({ name, reply }); },
    approvePlan: async () => {},
    createSession: async () => {
      const session = { name: `sessions/${sessions.size + 1}`, state: 'IN_PROGRESS' };
      sessions.set(session.name, session);
      return session;
    }
  };
  const github = {
    user: async () => ({}), repo: async () => ({ id: 7, full_name: 'owner/repo' }),
    branch: async () => ({ commit: { sha: 'commit' } }), commit: async () => ({ tree: { sha: 'tree' } }),
    tree: async () => ({ tree: [] }), pulls: async () => []
  };
  const services = {
    julesKey: () => store.getSecret('jules'), githubToken: () => store.getSecret('github'),
    deps: () => ({ jules, github }), orchestratorSettings: () => JSON.parse(store.get('orchestrator') ?? '{}'),
    julesFactory: () => jules, githubFactory: () => github,
    orchestratorFactory: () => { throw new Error('No real model calls in tests'); },
    promptPath: writePromptFixture(directory)
  };
  const coordinator = createResearchCoordinator(store, services);
  await new Promise(resolve => setImmediate(resolve));
  const handler = createRequestHandler(store, services, coordinator, {}, 'test-csrf');
  const request = async (path, values) => {
    const req = Readable.from(values ? [Buffer.from(new URLSearchParams({ csrf: 'test-csrf', ...values }).toString())] : []);
    Object.assign(req, { method: values ? 'POST' : 'GET', url: path, headers: { host: 'localhost' } });
    const result = {};
    await handler(req, { writeHead(status, headers) { Object.assign(result, { status, headers }); }, end(body) { result.body = body; } });
    return result;
  };
  return { store, jules, github, services, coordinator, sessions, sent, request,
    async cleanup() { coordinator.close(); await coordinator.schedule(); fixture.cleanup(); } };
}
