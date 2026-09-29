import { verifyRepository } from './core.mjs';
import { julesClient, githubClient } from './providers.mjs';

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
  const concurrency = boundedInt(env.CONCURRENCY, 10, 50, 'CONCURRENCY');
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
