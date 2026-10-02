import { verifyRepository } from './core.mjs';
import { julesClient, githubClient } from './providers.mjs';
import { NVIDIA_ENDPOINT, NVIDIA_MODEL } from './orchestrator.mjs';

export function applyApiKeysFromEnv(store, env = process.env) {
  const julesKey = env.JULES_API_KEY?.trim();
  const nvidiaKey = env.NVIDIA_API_KEY?.trim();
  const settings = JSON.parse(store.get('orchestrator') ?? '{}');
  let changed = false;
  if (julesKey && julesKey !== store.getSecret('jules')) {
    store.setSecret('jules', julesKey);
    changed = true;
  }
  // Never send an NVIDIA key to a different provider's saved endpoint.
  if (nvidiaKey && (!settings.provider || settings.provider === 'nvidia')) {
    if (!settings.provider) {
      store.set('orchestrator', JSON.stringify({ provider: 'nvidia', endpoint: NVIDIA_ENDPOINT, model: NVIDIA_MODEL, mode: 'continuous', intervalHours: 6, dailyLimit: 0, enabled: false }));
    }
    if (nvidiaKey !== store.getSecret('orchestrator')) {
      store.setSecret('orchestrator', nvidiaKey);
      changed = true;
    }
  }
  if (changed) {
    store.set('orchestratorRetryAt', '');
    store.set('orchestratorFailures', 0);
    store.set('orchestratorLastError', '');
    store.log('environment_keys_loaded', 'Loaded updated API keys from environment configuration');
  }
  return changed;
}

const runtimeValue = value => String(value ?? '30-60').replace('-', '–');
const boundedInt = (value, fallback, max, label) => {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`${label} must be between 1 and ${max}.`);
  return number;
};

export async function bootstrapFromEnv(store, env = process.env, { julesFactory = julesClient, githubFactory = githubClient } = {}) {
  if (store.binding()) return false;
  const julesKey = env.JULES_API_KEY?.trim();
  const githubToken = env.GITHUB_TOKEN?.trim();
  const owner = env.DEFAULT_GITHUB_OWNER?.trim();
  const repo = env.DEFAULT_GITHUB_REPO?.trim();
  const branch = env.DEFAULT_BASE_BRANCH?.trim();
  if (![julesKey, githubToken, owner, repo, branch].every(Boolean)) return false;
  const runtime = runtimeValue(env.RESEARCH_RUNTIME);
  if (!['15–30', '30–60', '60–120'].includes(runtime)) throw new Error('RESEARCH_RUNTIME must be 15-30, 30-60, or 60-120.');
  const developmentSeeds = boundedInt(env.DEVELOPMENT_SEEDS, 5, 100, 'DEVELOPMENT_SEEDS');
  const finalSeeds = boundedInt(env.FINAL_SEEDS, 10, 100, 'FINAL_SEEDS');
  const concurrency = boundedInt(env.CONCURRENCY, 10, 60, 'CONCURRENCY');
  const binding = await verifyRepository({ julesKey, githubToken, owner, repo, branch }, { jules: julesFactory(julesKey), github: githubFactory(githubToken) });
  store.setSecret('jules', julesKey);
  store.setSecret('github', githubToken);
  store.saveBinding(binding);
  store.replaceRemoteFolders(binding.folders);
  store.set('runtime', runtime);
  store.set('developmentSeeds', developmentSeeds);
  store.set('finalSeeds', finalSeeds);
  store.set('concurrency', concurrency);
  store.set('configured', '1');
  store.log('setup_completed', 'Setup completed from .env.local');
  return true;
}
