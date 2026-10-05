import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { julesClient, githubClient } from './providers.mjs';
import { orchestratorClient } from './orchestrator.mjs';
import { defaultPromptPath, initializePromptLibrary } from './prompt.mjs';
import { initializeFlow } from './flow.mjs';
import { createResearchCoordinator } from './research.mjs';
import { createFlowStream } from './flow-stream.mjs';
import { createRequestHandler } from './routes.mjs';

export function createApp(store, { julesFactory = julesClient, githubFactory = githubClient, orchestratorFactory = orchestratorClient, promptPath = defaultPromptPath } = {}) {
  initializePromptLibrary(store, promptPath);
  initializeFlow(store);
  const julesKey = () => store.getSecret('jules') ?? process.env.JULES_API_KEY;
  const githubToken = () => store.getSecret('github') ?? process.env.GITHUB_TOKEN;
  const services = {
    julesFactory, githubFactory, orchestratorFactory, promptPath, julesKey, githubToken,
    deps: () => ({ jules: julesFactory(julesKey()), github: githubFactory(githubToken()) }),
    orchestratorSettings: () => JSON.parse(store.get('orchestrator') ?? '{}'),
  };
  const coordinator = createResearchCoordinator(store, services);
  const flowStream = createFlowStream(coordinator.snapshot);
  const csrfToken = randomBytes(32).toString('hex');
  const server = createServer(createRequestHandler(store, services, coordinator, flowStream, csrfToken));

  return {
    server,
    launchResearchProject: coordinator.launchResearchProject,
    launchResearchBatch: coordinator.launchResearchBatch,
    pollSessions: coordinator.pollSessions,
    schedule: coordinator.schedule,
    runOrchestrator: coordinator.runOrchestrator,
    close() { coordinator.close(); flowStream.close(); server.close(); },
  };
}
