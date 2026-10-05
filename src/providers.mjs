const JULES = 'https://jules.googleapis.com/v1alpha';
const GITHUB = 'https://api.github.com';

export class ProviderError extends Error {
  constructor(provider, status, message, { retryAfterMs = 0, code = '' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.code = code;
  }
}

async function request(provider, url, headers, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers ?? {}) }, signal: AbortSignal.timeout(15000) });
  } catch (error) {
    throw new ProviderError(provider, 503, `${provider} is unavailable: ${error.message}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const explanation = response.status === 401 ? 'Invalid API key or token' : response.status === 403 ? 'Access denied or rate limited' : body.error?.message ?? body.message ?? response.statusText;
    const retryAfter = response.headers?.get('retry-after');
    const retryAfterMs = retryAfter ? Math.max(0, /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
    throw new ProviderError(provider, response.status, `${provider}: ${explanation}`, { retryAfterMs, code: body.error?.status ?? '' });
  }
  return body;
}

async function tokenPages(get, path, collection, { repeatedMessage, maxTokens = Infinity, maxItems = Infinity, limitMessage } = {}) {
  const all = [], seenTokens = new Set();
  let pageToken = '';
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await get(`${path}?${params}`);
    all.push(...(page[collection] ?? []));
    pageToken = page.nextPageToken ?? '';
    if (pageToken && repeatedMessage && seenTokens.has(pageToken)) throw new Error(repeatedMessage);
    if (pageToken) seenTokens.add(pageToken);
    if (all.length > maxItems || seenTokens.size > maxTokens) throw new Error(limitMessage);
  } while (pageToken);
  return all;
}

async function numberedPages(get, path) {
  const all = [];
  for (let page = 1; ; page++) {
    const result = await get(`${path}?per_page=100&page=${page}`);
    all.push(...result);
    if (result.length < 100) return all;
  }
}

function sessionPath(name) {
  if (!/^sessions\/[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid Jules session name');
  return `/${name}`;
}

export function julesClient(apiKey) {
  const headers = { 'x-goog-api-key': apiKey, accept: 'application/json' };
  const get = path => request('Jules', `${JULES}${path}`, headers);
  const post = (path, body) => request('Jules', `${JULES}${path}`, headers, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  return {
    sessions: () => tokenPages(get, '/sessions', 'sessions', {
      repeatedMessage: 'Jules repeated a session page.', maxTokens: 100,
      limitMessage: 'Jules session history is too large to check capacity.'
    }),
    async sources() {
      const all = await tokenPages(get, '/sources', 'sources');
      return all.filter(source => source.name && source.githubRepo?.owner && source.githubRepo?.repo);
    },
    source(name) {
      if (!/^sources\/[a-zA-Z0-9/_-]+$/.test(name)) throw new Error('Invalid Jules source name');
      return get(`/${name}`);
    },
    session(name) {
      return get(sessionPath(name));
    },
    deleteSession(name) {
      return request('Jules', `${JULES}${sessionPath(name)}`, headers, { method: 'DELETE' });
    },
    approvePlan(name) {
      return post(`${sessionPath(name)}:approvePlan`, {});
    },
    sendMessage(name, prompt) {
      const path = sessionPath(name);
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 10000) throw new Error('Enter a message of 1–10,000 characters.');
      return post(`${path}:sendMessage`, { prompt: prompt.trim() });
    },
    async activities(name) {
      return tokenPages(get, `${sessionPath(name)}/activities`, 'activities', {
        repeatedMessage: 'Jules repeated an activity page. Open the session in Jules for the full history.',
        maxItems: 5000, maxTokens: 50,
        limitMessage: 'Jules returned more than 5,000 activities for one session. Open the session in Jules for the full history.'
      });
    },
    createSession({ prompt, title, sourceName, branch }) {
      return post('/sessions', { prompt, title, sourceContext: { source: sourceName, githubRepoContext: { startingBranch: branch } }, requirePlanApproval: false, automationMode: 'AUTO_CREATE_PR' });
    }
  };
}

export function githubClient(token) {
  const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'ResearchFacility/0.1' };
  const get = path => request('GitHub', `${GITHUB}${path}`, headers);
  const repoPath = (owner, repo) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return {
    user: () => get('/user'),
    repo: (owner, repo) => get(repoPath(owner, repo)),
    branch: (owner, repo, branch) => get(`${repoPath(owner, repo)}/branches/${encodeURIComponent(branch)}`),
    commit: (owner, repo, sha) => get(`${repoPath(owner, repo)}/git/commits/${encodeURIComponent(sha)}`),
    branches: async (owner, repo) => numberedPages(get, `${repoPath(owner, repo)}/branches`),
    root: (owner, repo, branch) => get(`${repoPath(owner, repo)}/contents?ref=${encodeURIComponent(branch)}`),
    tree: (owner, repo, sha) => get(`${repoPath(owner, repo)}/git/trees/${encodeURIComponent(sha)}`),
    pulls: (owner, repo) => get(`${repoPath(owner, repo)}/pulls?state=open&per_page=1`),
    pull: (owner, repo, number) => get(`${repoPath(owner, repo)}/pulls/${number}`),
    pullFiles: async (owner, repo, number) => numberedPages(get, `${repoPath(owner, repo)}/pulls/${number}/files`)
  };
}
