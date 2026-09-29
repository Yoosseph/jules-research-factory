const JULES = 'https://jules.googleapis.com/v1alpha';
const GITHUB = 'https://api.github.com';

export class ProviderError extends Error {
  constructor(provider, status, message) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
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
    throw new ProviderError(provider, response.status, `${provider}: ${explanation}`);
  }
  return body;
}

export function julesClient(apiKey) {
  const headers = { 'x-goog-api-key': apiKey, accept: 'application/json' };
  const get = path => request('Jules', `${JULES}${path}`, headers);
  return {
    async sources() {
      const all = [];
      let pageToken = '';
      do {
        const params = new URLSearchParams({ pageSize: '100' });
        if (pageToken) params.set('pageToken', pageToken);
        const page = await get(`/sources?${params}`);
        all.push(...(page.sources ?? []));
        pageToken = page.nextPageToken ?? '';
      } while (pageToken);
      return all.filter(source => source.name && source.githubRepo?.owner && source.githubRepo?.repo);
    },
    source(name) {
      if (!/^sources\/[a-zA-Z0-9/_-]+$/.test(name)) throw new Error('Invalid Jules source name');
      return get(`/${name}`);
    },
    session(name) {
      if (!/^sessions\/[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid Jules session name');
      return get(`/${name}`);
    },
    deleteSession(name) {
      if (!/^sessions\/[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid Jules session name');
      return request('Jules', `${JULES}/${name}`, headers, { method: 'DELETE' });
    },
    approvePlan(name) {
      if (!/^sessions\/[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid Jules session name');
      return request('Jules', `${JULES}/${name}:approvePlan`, headers, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
      });
    },
    sendMessage(name, prompt) {
      if (!/^sessions\/[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid Jules session name');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 10000) throw new Error('Enter a message of 1–10,000 characters.');
      return request('Jules', `${JULES}/${name}:sendMessage`, headers, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: prompt.trim() })
      });
    },
    async activities(name) {
      if (!/^sessions\/[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid Jules session name');
      const all = [];
      let pageToken = '';
      const seenTokens = new Set();
      do {
        const params = new URLSearchParams({ pageSize: '100' });
        if (pageToken) params.set('pageToken', pageToken);
        const page = await get(`/${name}/activities?${params}`);
        all.push(...(page.activities ?? []));
        pageToken = page.nextPageToken ?? '';
        if (pageToken && seenTokens.has(pageToken)) throw new Error('Jules repeated an activity page. Open the session in Jules for the full history.');
        if (pageToken) seenTokens.add(pageToken);
        if (all.length > 5000 || seenTokens.size > 50) throw new Error('Jules returned more than 5,000 activities for one session. Open the session in Jules for the full history.');
      } while (pageToken);
      return all;
    },
    createSession({ prompt, title, sourceName, branch }) {
      return request('Jules', `${JULES}/sessions`, headers, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, title, sourceContext: { source: sourceName, githubRepoContext: { startingBranch: branch } }, requirePlanApproval: false, automationMode: 'AUTO_CREATE_PR' })
      });
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
    async branches(owner, repo) {
      const all = [];
      for (let page = 1; ; page++) {
        const result = await get(`${repoPath(owner, repo)}/branches?per_page=100&page=${page}`);
        all.push(...result);
        if (result.length < 100) return all;
      }
    },
    root: (owner, repo, branch) => get(`${repoPath(owner, repo)}/contents?ref=${encodeURIComponent(branch)}`),
    tree: (owner, repo, sha) => get(`${repoPath(owner, repo)}/git/trees/${encodeURIComponent(sha)}`),
    pulls: (owner, repo) => get(`${repoPath(owner, repo)}/pulls?state=open&per_page=1`),
    pull: (owner, repo, number) => get(`${repoPath(owner, repo)}/pulls/${number}`),
    async pullFiles(owner, repo, number) {
      const all = [];
      for (let page = 1; ; page++) {
        const result = await get(`${repoPath(owner, repo)}/pulls/${number}/files?per_page=100&page=${page}`);
        all.push(...result);
        if (result.length < 100) return all;
      }
    }
  };
}
