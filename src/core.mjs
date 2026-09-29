import { julesClient, githubClient } from './providers.mjs';
import { readPromptTemplate, renderPrompt } from './prompt.mjs';

export class BindingError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'BindingError'; this.details = details; }
}

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
export function numberedFolders(contents) {
  return (Array.isArray(contents) ? contents : [])
    .filter(item => item.type === 'dir' && /^([1-9]\d*)-.+/.test(item.name))
    .map(item => ({ name: item.name, number: Number(item.name.match(/^\d+/)[0]) }));
}

export async function discoverSources(julesKey, deps = {}) {
  return (deps.jules ?? julesClient(julesKey)).sources();
}

export async function verifyRepository({ julesKey, githubToken, owner, repo, branch, sourceName, expectedGithubId }, deps = {}) {
  if (!julesKey || !githubToken) throw new BindingError('Both Jules and GitHub credentials are required.');
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(owner ?? '') || !/^[a-z\d._-]+$/i.test(repo ?? '')) {
    throw new BindingError('Enter a valid GitHub owner and repository.');
  }
  const jules = deps.jules ?? julesClient(julesKey);
  const github = deps.github ?? githubClient(githubToken);
  const sources = await jules.sources();
  const matching = sources.filter(item => same(item.githubRepo.owner, owner) && same(item.githubRepo.repo, repo));
  const source = sourceName ? matching.find(item => item.name === sourceName) : matching[0];
  if (!source) throw new BindingError(`Could not locate ${owner}/${repo} in Jules. Grant Jules access in its web app, then retry.`, { code: 'SOURCE_MISSING' });
  const detailed = await jules.source(source.name);
  if (detailed.name !== source.name || !same(detailed.githubRepo?.owner, owner) || !same(detailed.githubRepo?.repo, repo)) {
    throw new BindingError(`Repository binding mismatch: Jules source ${source.name} does not match ${owner}/${repo}.`);
  }
  await github.user();
  let ghRepo;
  try { ghRepo = await github.repo(owner, repo); }
  catch (error) {
    if (error.status === 404) throw new BindingError(`GitHub cannot access ${owner}/${repo} with this token. Check its resource owner and selected repositories.`);
    throw error;
  }
  if (!same(ghRepo.full_name, `${owner}/${repo}`) || !ghRepo.id) throw new BindingError('GitHub returned a different repository identity.');
  if (expectedGithubId && String(ghRepo.id) !== String(expectedGithubId)) throw new BindingError('GitHub repository identity changed. Repair the binding before launching.');
  const selectedBranch = branch || 'main';
  let branches;
  let branchInfo;
  try { branchInfo = await github.branch(owner, repo, selectedBranch); }
  catch (error) {
    if (error.status !== 404) throw error;
    branches = (await github.branches(owner, repo)).map(item => item.name);
    throw new BindingError(`${selectedBranch} was not found. Choose an available branch.`, { code: 'BRANCH_MISSING', branches });
  }
  const julesBranches = detailed.githubRepo?.branches?.map(item => item.displayName) ?? [];
  if (julesBranches.length && !julesBranches.includes(selectedBranch)) {
    throw new BindingError(`Jules cannot see branch ${selectedBranch}. Refresh its repository access before launching.`, { code: 'JULES_BRANCH_MISSING' });
  }
  try { await github.pulls(owner, repo); }
  catch (error) {
    if (error.status === 404) throw new BindingError(`GitHub cannot read pull requests for ${owner}/${repo}. Grant the token Pull requests: read access.`);
    throw error;
  }
  let commit;
  try { commit = await github.commit(owner, repo, branchInfo.commit.sha); }
  catch (error) {
    if (error.status === 404) throw new BindingError(`GitHub cannot read commits for ${owner}/${repo}. Grant the token Contents: read access.`);
    throw error;
  }
  if (!commit.tree?.sha) throw new BindingError('GitHub did not provide the branch root tree.');
  let tree;
  try { tree = await github.tree(owner, repo, commit.tree.sha); }
  catch (error) {
    if (error.status === 404) throw new BindingError(`GitHub cannot read the tree for ${owner}/${repo}. Grant the token Contents: read access.`);
    throw error;
  }
  if (tree.truncated) throw new BindingError('GitHub returned an incomplete repository tree. Refresh and retry.');
  const folders = numberedFolders(tree.tree?.map(item => ({ name: item.path, type: item.type === 'tree' ? 'dir' : 'file' })));
  return { owner: ghRepo.owner?.login ?? owner, repo: ghRepo.name ?? repo, fullName: ghRepo.full_name, githubId: String(ghRepo.id), branch: selectedBranch, sourceName: detailed.name, folders };
}

export async function verifyBinding(store, deps = {}) {
  const binding = store.binding();
  if (!binding) throw new BindingError('No repository is connected. Complete setup first.');
  const result = await verifyRepository({
    julesKey: store.getSecret('jules') ?? process.env.JULES_API_KEY,
    githubToken: store.getSecret('github') ?? process.env.GITHUB_TOKEN,
    owner: binding.github_owner, repo: binding.github_repo, branch: binding.base_branch,
    sourceName: binding.jules_source_id, expectedGithubId: binding.github_repository_id
  }, deps);
  if (!same(result.fullName, binding.github_full_name)) throw new BindingError('Repository full name changed. Repair the binding before launching.');
  return result;
}

export function verifyReservations(projects, folders) {
  const ids = new Set(), numbers = new Set(), names = new Set();
  const remoteNumbers = new Set(folders.map(folder => folder.number));
  const remoteNames = new Set(folders.map(folder => folder.name.toLowerCase()));
  for (const project of projects) {
    if (!project || ids.has(project.id)) throw new BindingError('Duplicate or missing project ID in batch.');
    if (numbers.has(project.folder_number) || names.has(project.folder.toLowerCase())) throw new BindingError('Duplicate folder reservation in batch.');
    if (remoteNumbers.has(project.folder_number) || remoteNames.has(project.folder.toLowerCase())) throw new BindingError(`${project.folder} now conflicts with a GitHub folder. Reserve a new project number.`);
    if (project.folder !== `${project.folder_number}-${project.slug}`) throw new BindingError(`Reservation for ${project.id} is invalid.`);
    ids.add(project.id); numbers.add(project.folder_number); names.add(project.folder.toLowerCase());
  }
}

export function verifyProjectBinding(projects, binding) {
  const identity = `${binding.github_repository_id}|${binding.jules_source_id}|${binding.base_branch}`;
  if (projects.some(project => project.binding_identity !== identity)) {
    throw new BindingError('A reserved project belongs to a previous repository binding. Create new topics for this destination.');
  }
}

export function researchPrompt(project, binding, defaults, template = readPromptTemplate()) {
  return renderPrompt(template, project, binding, defaults);
}

export function parsePullRequestUrl(url, binding) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new BindingError('Jules returned an invalid pull request URL.'); }
  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
  if (parsed.hostname !== 'github.com' || !match || !same(match[1], binding.github_owner) || !same(match[2], binding.github_repo)) {
    throw new BindingError('The pull request points to a different repository.');
  }
  return Number(match[3]);
}

export async function validatePullRequest(url, project, binding, github) {
  const number = parsePullRequestUrl(url, binding);
  const pull = await github.pull(binding.github_owner, binding.github_repo, number);
  if (String(pull.base?.repo?.id) !== String(binding.github_repository_id) || pull.base?.ref !== binding.base_branch) {
    throw new BindingError('The pull request targets a different repository or base branch.');
  }
  const files = await github.pullFiles(binding.github_owner, binding.github_repo, number);
  if (!files.length || files.some(file => !file.filename?.startsWith(`${project.folder}/`) || file.previous_filename && !file.previous_filename.startsWith(`${project.folder}/`))) {
    throw new BindingError(`Pull request changes files outside ${project.folder}/.`);
  }
  return { number, files: files.length, status: pull.merged_at ? 'merged' : pull.state === 'closed' ? 'closed' : 'open' };
}
