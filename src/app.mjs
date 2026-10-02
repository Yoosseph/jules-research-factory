import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { discoverSources, verifyRepository, verifyBinding, verifyReservations, verifyProjectBinding, researchPrompt, validatePullRequest, BindingError } from './core.mjs';
import { julesClient, githubClient } from './providers.mjs';
import { setupPage, dashboardPage, preflightPage, settingsPage, guidePage, layout, styleHash } from './ui.mjs';
import { promptPage, activityPage, agentSettingsPage, projectPage, orchestratorPage } from './work-ui.mjs';
import { defaultPromptPath, readPromptTemplate, initializePromptLibrary, syncActivePrompt, promptLibrary, saveActivePrompt, savePromptAsNew, activatePrompt } from './prompt.mjs';
import { saveActivities } from './activities.mjs';
import { NVIDIA_ENDPOINT, NVIDIA_MODEL, validateOrchestratorSettings, orchestratorClient, proposeResearch, draftJulesReply } from './orchestrator.mjs';
import { welcomePage } from './landing-ui.mjs';

const defaults = store => ({ runtime: store.get('runtime') ?? '30–60', developmentSeeds: Number(store.get('developmentSeeds') ?? 5), finalSeeds: Number(store.get('finalSeeds') ?? 10), concurrency: Number(store.get('concurrency') ?? 10), autoReply: store.get('autoReply') !== '0' });
const autonomousReply = 'Please continue without waiting for me. Make the reasonable choice that best satisfies the original research prompt and stays inside the assigned project folder. If a source, tool, or approach is unavailable, choose a viable alternative. Document the decision and its limits in the report, complete the requested deliverables, and create the pull request.';
const csrfToken = randomBytes(32).toString('hex');
const safeEqual = (a, b) => { const x = Buffer.from(a ?? ''), y = Buffer.from(b ?? ''); return x.length === y.length && timingSafeEqual(x, y); };
const html = (response, body, status = 200) => { response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': `default-src 'self'; style-src 'sha256-${styleHash}'; font-src 'self'; script-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` }); response.end(body); };
const redirect = (response, path) => { response.writeHead(303, { location: path, 'cache-control': 'no-store' }); response.end(); };
const dateNow = () => new Date().toISOString();
const messageUrl = (path, message, type = 'message') => `${path}${path.includes('?') ? '&' : '?'}${type}=${encodeURIComponent(message)}`;
const selectionUrl = ids => `/preflight?${ids.map(id => `id=${encodeURIComponent(id)}`).join('&')}`;

function parseDefaults(form) {
  const runtime = form.get('runtime');
  const developmentSeeds = Number(form.get('developmentSeeds'));
  const finalSeeds = Number(form.get('finalSeeds'));
  const concurrency = Number(form.get('concurrency'));
  if (!['15–30', '30–60', '60–120'].includes(runtime) ||
      !Number.isInteger(developmentSeeds) || developmentSeeds < 1 || developmentSeeds > 100 ||
      !Number.isInteger(finalSeeds) || finalSeeds < 1 || finalSeeds > 100 ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 60) {
    throw new Error('Choose a runtime and enter whole-number seeds (1–100) and concurrency (1–60).');
  }
  return { runtime, developmentSeeds, finalSeeds, concurrency };
}

function saveDefaults(store, values) {
  for (const [key, value] of Object.entries(values)) store.set(key, value);
}

async function bodyParams(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new Error('Form is too large.');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function idsFrom(value) {
  const ids = value.getAll('projectId').length ? value.getAll('projectId') : value.getAll('id');
  if (!ids.length || ids.length > 50 || ids.some(id => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('Select 1–50 valid projects.');
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate project IDs are not allowed.');
  return ids;
}

export function createApp(store, { julesFactory = julesClient, githubFactory = githubClient, orchestratorFactory = orchestratorClient, promptPath = defaultPromptPath } = {}) {
  initializePromptLibrary(store, promptPath);
  let schedulerBusy = false;
  let schedulerRerunRequested = false;
  let schedulerPromise;
  let pollingBusy = false;
  let orchestratorBusy = false;
  let closed = false;
  const sessionRepliesInFlight = new Set();
  const julesKey = () => store.getSecret('jules') ?? process.env.JULES_API_KEY;
  const githubToken = () => store.getSecret('github') ?? process.env.GITHUB_TOKEN;
  const deps = () => ({ jules: julesFactory(julesKey()), github: githubFactory(githubToken()) });
  const orchestratorSettings = () => JSON.parse(store.get('orchestrator') ?? '{}');
  const orchestratorUsage = () => Number(store.get('orchestratorDay') === dateNow().slice(0, 10) ? store.get('orchestratorCount') ?? 0 : 0);
  const modelClient = () => orchestratorFactory({ ...orchestratorSettings(), apiKey: store.getSecret('orchestrator') });
  const listSources = async () => julesKey() ? discoverSources(julesKey(), { jules: julesFactory(julesKey()) }) : [];
  const atDailyLimit = () => {
    const limit = orchestratorSettings().dailyLimit;
    return limit > 0 && orchestratorUsage() >= limit;
  };
  const coolingDown = () => Date.parse(store.get('orchestratorRetryAt') ?? '') > Date.now();
  const continuous = () => {
    const settings = orchestratorSettings();
    return settings.enabled && settings.mode === 'continuous';
  };
  function resetCooldown() {
    store.set('orchestratorRetryAt', '');
    store.set('orchestratorFailures', 0);
    store.set('orchestratorLastError', '');
  }
  function deferResearch(error) {
    const failures = Math.min(10, Number(store.get('orchestratorFailures') ?? 0) + 1);
    const minimum = [401, 403].includes(error.status) && error.code !== 'RESOURCE_EXHAUSTED' ? 3600000 : error.status === 429 || error.code === 'RESOURCE_EXHAUSTED' ? 300000 : 60000;
    const delay = Math.max(Math.min(3600000, minimum * 2 ** (failures - 1)), error.retryAfterMs || 0);
    store.set('orchestratorFailures', failures);
    store.set('orchestratorRetryAt', new Date(Date.now() + delay).toISOString());
    store.set('orchestratorLastError', error.message);
    store.log('orchestrator_waiting', error.message);
  }
  async function occupiedSlots(includeQueued = false) {
    const projects = store.projects().filter(project => ['launching', 'running', ...(includeQueued ? ['queued'] : [])].includes(project.status));
    const names = new Set(projects.map(project => project.jules_session_name).filter(Boolean));
    const client = julesFactory(julesKey());
    // Include tasks started outside this app; Jules owns the account-wide quota.
    const sessions = client.sessions ? await client.sessions() : [];
    const external = sessions.filter(session => !['COMPLETED', 'FAILED', 'STOPPED'].includes(session.state) && !names.has(session.name));
    const remoteByName = new Map(sessions.map(session => [session.name, session]));
    const localActive = projects.filter(project => !['COMPLETED', 'FAILED', 'STOPPED'].includes(remoteByName.get(project.jules_session_name)?.state));
    return localActive.length + external.length;
  }

  async function setupView(response, options = {}) {
    const binding = store.binding();
    const forcedRebind = options.rebind;
    let sources = [];
    let error = options.error;
    let stepNumber = !julesKey() ? 1 : forcedRebind || !binding ? 2 : store.get('configured') !== '1' ? 3 : 2;
    if (options.defaults && binding) stepNumber = 3;
    if (stepNumber === 2) {
      try { sources = await listSources(); }
      catch (cause) { error ||= cause.message; }
    }
    const prefill = { owner: process.env.DEFAULT_GITHUB_OWNER, repo: process.env.DEFAULT_GITHUB_REPO, branch: process.env.DEFAULT_BASE_BRANCH || 'main', ...options.prefill };
    html(response, setupPage({ stepNumber, sources, binding, folders: store.remoteFolders(), defaults: defaults(store), error, branches: options.branches ?? [], csrfToken, prefill, rebind: !!forcedRebind, connectedJules: !!julesKey() && !error, nextProjectNumber: store.nextProjectNumber() }), error ? 422 : 200);
  }

  async function refresh() {
    const result = await verifyBinding(store, deps());
    store.replaceRemoteFolders(result.folders);
    store.saveBinding(result);
    store.log('binding_verified', `Verified ${result.fullName} on ${result.branch}`);
    return result;
  }

  async function checkedProjects(ids, allowedStatuses) {
    const projects = ids.map(id => store.project(id));
    if (projects.some(project => !project || !allowedStatuses.includes(project.status))) throw new BindingError('One or more projects are unavailable for this launch.');
    verifyProjectBinding(projects, store.binding());
    const result = await verifyBinding(store, deps());
    verifyReservations(projects, result.folders);
    store.replaceRemoteFolders(result.folders);
    return projects;
  }

  async function launchResearchProject(projectId) {
    const project = store.project(projectId);
    if (!project || project.status !== 'queued') return;
    const binding = store.binding();
    let submitted = false;
    try {
      await checkedProjects([projectId], ['queued']);
      const current = store.project(projectId);
      store.db.prepare('UPDATE projects SET status=?,updated_at=? WHERE id=? AND status=?').run('launching', dateNow(), projectId, 'queued');
      store.log('launching', `Starting ${current.folder} in ${binding.github_full_name}`, projectId);
      const prompt = researchPrompt(current, binding, defaults(store), readPromptTemplate(promptPath));
      store.db.prepare('UPDATE projects SET prompt_text=? WHERE id=?').run(prompt, projectId);
      submitted = true;
      const session = await julesFactory(julesKey()).createSession({ prompt, title: `${current.folder}: ${current.topic}`.slice(0, 100), sourceName: binding.jules_source_id, branch: binding.base_branch });
      if (!/^sessions\/[a-zA-Z0-9_-]+$/.test(session.name ?? '')) throw new Error('Jules returned no valid session identifier. Check Jules before retrying.');
      const url = /^https:\/\/jules\.google\.com\//.test(session.url ?? '') ? session.url : null;
      store.db.prepare('UPDATE projects SET status=?,jules_state=?,jules_session_name=?,jules_session_url=?,error=NULL,updated_at=? WHERE id=?').run('running', session.state || 'QUEUED', session.name, url, dateNow(), projectId);
      store.log('session_created', `${session.name} launched for ${current.folder}`, projectId);
      if (current.orchestrator_instructions) {
        const usedToday = orchestratorUsage();
        store.set('orchestratorDay', dateNow().slice(0, 10));
        store.set('orchestratorCount', usedToday + 1);
        resetCooldown();
      }
    } catch (error) {
      // Only a definite rejection or a failure before submission can be retried.
      const rejected = [401, 403, 429].includes(error.status) || error.code === 'RESOURCE_EXHAUSTED';
      const retryable = rejected || (!submitted && error.status >= 500);
      store.db.prepare('UPDATE projects SET status=?,error=?,updated_at=? WHERE id=?').run(retryable ? 'queued' : 'blocked', error.message, dateNow(), projectId);
      store.log(retryable ? 'launch_deferred' : 'launch_blocked', error.message, projectId);
      deferResearch(error);
    }
  }

  async function launchResearchBatch(ids) {
    const projects = await checkedProjects(ids, ['reserved']);
    store.db.exec('BEGIN IMMEDIATE');
    try {
      const update = store.db.prepare('UPDATE projects SET status=?,updated_at=? WHERE id=? AND status=?');
      for (const project of projects) {
        if (update.run('queued', dateNow(), project.id, 'reserved').changes !== 1) throw new Error('Project reservation changed during launch.');
        store.log('queued', `Queued ${project.folder}`, project.id);
      }
      store.db.exec('COMMIT');
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
    void schedule();
  }

  async function runOrchestrator(manual = false) {
    if (manual && orchestratorBusy) throw new Error('An orchestrator attempt is already running. Wait for it to finish.');
    if (closed || orchestratorBusy || store.get('configured') !== '1' || !store.binding()) return null;
    const settings = orchestratorSettings();
    if ((!manual && !settings.enabled) || !store.getSecret('orchestrator') || !settings.brief) return null;
    if (manual && atDailyLimit()) throw new Error('The app daily task cap has been reached. Increase it or set it to 0 under Launch settings.');
    if (manual && coolingDown()) throw new Error(`Research is paused until ${store.get('orchestratorRetryAt')}. ${store.get('orchestratorLastError') || 'A provider retry is pending.'}`);
    if (atDailyLimit() || coolingDown()) return null;
    if (!manual) {
      const last = Date.parse(store.get('orchestratorLastAttempt') ?? '');
      if (settings.mode !== 'continuous' && Number.isFinite(last) && Date.now() - last < settings.intervalHours * 3600000) return null;
      const pending = store.db.prepare("SELECT COUNT(*) AS n FROM projects WHERE status IN ('reserved','queued','launching','running')").get().n;
      if (settings.mode !== 'continuous' && pending) return null;
    }
    orchestratorBusy = true;
    let project;
    let firstProject;
    try {
      await schedule();
      do {
        if (closed || coolingDown() || atDailyLimit() || (!manual && !orchestratorSettings().enabled)) break;
        if (await occupiedSlots(true) >= defaults(store).concurrency) break;
        store.set('orchestratorLastAttempt', dateNow());
        project = null;
        const binding = await refresh();
        const recentTopics = store.projects().slice(0, 30).map(project => project.topic);
        const planningClient = modelClient();
        const proposal = await proposeResearch(planningClient, { brief: settings.brief, repository: binding.fullName, recentTopics });
        if (closed) return null;
        const currentBinding = store.binding();
        if (store.get('orchestrator') !== JSON.stringify(settings) || currentBinding.github_repository_id !== binding.githubId || currentBinding.base_branch !== binding.branch || currentBinding.jules_source_id !== binding.sourceName) {
          throw new Error('Orchestrator settings or repository changed during the proposal. Retry with the current settings.');
        }
        if (!manual && !orchestratorSettings().enabled) return null;
        // Manual launches or a changed concurrency setting can take a slot while the model responds.
        if (await occupiedSlots(true) >= defaults(store).concurrency || atDailyLimit()) break;
        if (closed || (!manual && !orchestratorSettings().enabled)) break;
        if (store.get('orchestrator') !== JSON.stringify(settings)) throw new Error('Orchestrator settings changed while checking Jules capacity.');
        const instructions = `${proposal.instructions}\n\nWork autonomously: do not ask the user questions or wait for clarification. Choose reasonable assumptions and accessible public sources. Document gaps and finish the report and pull request inside the assigned folder.`;
        [project] = store.reserve([proposal.topic], instructions);
        store.log('orchestrator_proposed', `Model proposed ${project.folder}`, project.id);
        await launchResearchBatch([project.id]);
        await schedule();
        firstProject ??= project;
        if (store.project(project.id)?.status !== 'running') break;
      } while (!manual && settings.mode === 'continuous');
      return firstProject ?? null;
    } catch (error) {
      if (project && store.project(project.id)?.status === 'reserved') store.removeReservation(project.id);
      deferResearch(error);
      store.log('orchestrator_error', error.message);
      if (manual) throw error;
      return null;
    } finally { orchestratorBusy = false; }
  }

  function schedule() {
    if (schedulerBusy) { schedulerRerunRequested = true; return schedulerPromise; }
    if (closed || store.get('configured') !== '1' || coolingDown()) return Promise.resolve();
    schedulerBusy = true;
    schedulerPromise = (async () => {
      try {
        do {
          schedulerRerunRequested = false;
          let active = await occupiedSlots();
          const limit = defaults(store).concurrency;
          const queued = store.db.prepare("SELECT id FROM projects WHERE status='queued' ORDER BY folder_number").all();
          for (const item of queued) {
            if (closed || coolingDown() || active >= limit) break;
            const project = store.project(item.id);
            if (project.orchestrator_instructions && atDailyLimit()) continue;
            await launchResearchProject(item.id);
            if (store.project(item.id)?.status === 'running') active++;
          }
        } while (schedulerRerunRequested && !closed && !coolingDown());
      } catch (error) {
        deferResearch(error);
      } finally {
        schedulerBusy = false;
      }
    })();
    return schedulerPromise;
  }

  async function autoReplyToFeedback(project, jules, activities) {
    if (store.get('autoReply') === '0' && !continuous()) return;
    const prefix = `${project.jules_session_name}/activities/`;
    const messages = activities.filter(item => typeof item.name === 'string' && item.name.startsWith(prefix) && !item.name.slice(prefix.length).includes('/') && (item.agentMessaged?.agentMessage || item.userMessaged?.userMessage))
      .sort((a, b) => String(a.createTime ?? '').localeCompare(String(b.createTime ?? '')) || a.name.localeCompare(b.name));
    const question = messages.findLast(item => item.agentMessaged?.agentMessage);
    if (!question || messages.at(-1) !== question) return;
    const count = store.db.prepare("SELECT COUNT(*) AS n FROM jules_auto_replies WHERE project_id=? AND status IN ('sending','sent') AND activity_name IN (SELECT name FROM jules_activities WHERE project_id=? AND kind='message' AND originator='agent')").get(project.id, project.id).n;
    if (count >= 3 && !continuous()) return;
    if (store.autoReplies(project.id).some(reply => reply.activity_name === question.name)) return;
    let reply = autonomousReply;
    let replyFrom = 'coordinator';
    const orchestrator = orchestratorSettings();
    if (orchestrator.brief && store.getSecret('orchestrator')) {
      try {
        reply = await draftJulesReply(modelClient(project.id), { brief: orchestrator.brief, topic: project.topic, instructions: project.orchestrator_instructions, question: question.agentMessaged.agentMessage });
        replyFrom = 'model';
      } catch (error) { store.log('orchestrator_reply_error', error.message, project.id); }
    }
    const now = dateNow();
    const claimed = store.db.prepare("INSERT OR IGNORE INTO jules_auto_replies(activity_name,project_id,status,created_at,updated_at) VALUES (?,?,'sending',?,?)").run(question.name, project.id, now, now);
    if (claimed.changes !== 1) return;
    try {
      await jules.sendMessage(project.jules_session_name, reply);
      store.db.prepare("UPDATE jules_auto_replies SET status='sent',updated_at=? WHERE activity_name=?").run(dateNow(), question.name);
      store.log('auto_feedback_sent', `Answered a Jules question for ${project.folder} using the autonomous research policy`, project.id);
    } catch (error) {
      // A timed-out request may have reached Jules. Never send the same reply twice automatically.
      store.db.prepare("UPDATE jules_auto_replies SET status='uncertain',error=?,updated_at=? WHERE activity_name=?").run(error.message, dateNow(), question.name);
      store.log('auto_feedback_error', error.message, project.id);
    }
  }

  async function autoApprovePlan(project, jules, activities) {
    if (store.get('autoReply') === '0' && !continuous()) return;
    const prefix = `${project.jules_session_name}/activities/`;
    const plan = activities.filter(item => typeof item.name === 'string' && item.name.startsWith(prefix) && item.planGenerated?.plan)
      .sort((a, b) => String(a.createTime ?? '').localeCompare(String(b.createTime ?? '')) || a.name.localeCompare(b.name)).at(-1);
    if (!plan) return;
    const count = store.db.prepare("SELECT COUNT(*) AS n FROM jules_auto_replies WHERE project_id=? AND status IN ('sending','sent') AND activity_name IN (SELECT name FROM jules_activities WHERE project_id=? AND kind='plan' AND summary='Plan generated')").get(project.id, project.id).n;
    if (count >= 3 && !continuous()) return;
    const now = dateNow();
    const claimed = store.db.prepare("INSERT OR IGNORE INTO jules_auto_replies(activity_name,project_id,status,created_at,updated_at) VALUES (?,?,'sending',?,?)").run(plan.name, project.id, now, now);
    if (claimed.changes !== 1) return;
    try {
      await jules.approvePlan(project.jules_session_name);
      store.db.prepare("UPDATE jules_auto_replies SET status='sent',updated_at=? WHERE activity_name=?").run(dateNow(), plan.name);
      store.log('auto_plan_approved', `Approved Jules plan for ${project.folder}`, project.id);
    } catch (error) {
      store.db.prepare("UPDATE jules_auto_replies SET status='uncertain',error=?,updated_at=? WHERE activity_name=?").run(error.message, dateNow(), plan.name);
      store.log('auto_plan_error', error.message, project.id);
    }
  }

  async function pollSessions() {
    if (pollingBusy) return;
    pollingBusy = true;
    try {
      const validated = store.db.prepare("SELECT * FROM projects WHERE status='pr_validated'").all();
      const running = store.db.prepare("SELECT * FROM projects WHERE status='running'").all();
      for (const project of running) {
        try {
          const jules = julesFactory(julesKey());
          const session = await jules.session(project.jules_session_name);
          store.db.prepare('UPDATE projects SET jules_state=?,jules_polled_at=? WHERE id=?').run(session.state || 'STATE_UNSPECIFIED', dateNow(), project.id);
          try {
            const activities = await jules.activities(project.jules_session_name);
            saveActivities(store, project.id, project.jules_session_name, activities);
            store.db.prepare('UPDATE projects SET activity_error=NULL WHERE id=?').run(project.id);
            if (session.state === 'AWAITING_PLAN_APPROVAL') await autoApprovePlan(project, jules, activities);
            if (['AWAITING_USER_FEEDBACK', 'PAUSED'].includes(session.state)) await autoReplyToFeedback(project, jules, activities);
          } catch (activityError) {
            store.db.prepare('UPDATE projects SET activity_error=? WHERE id=?').run(activityError.message, project.id);
            store.log('activity_poll_error', activityError.message, project.id);
          }
          if (session.state === 'FAILED') {
            store.db.prepare('UPDATE projects SET status=?,error=?,updated_at=? WHERE id=?').run('failed', 'Jules reported a failed session.', dateNow(), project.id);
            store.log('session_failed', 'Jules reported a failed session.', project.id);
          } else if (session.state === 'COMPLETED') {
            const prUrl = session.outputs?.map(output => output.pullRequest?.url).find(Boolean);
            if (!prUrl) {
              store.db.prepare('UPDATE projects SET status=?,error=?,updated_at=? WHERE id=?').run('completed_no_pr', 'Jules completed without a pull request. Review the session.', dateNow(), project.id);
              continue;
            }
            const binding = store.binding();
            verifyProjectBinding([project], binding);
            const checked = await validatePullRequest(prUrl, project, binding, githubFactory(githubToken()));
            store.db.prepare('UPDATE projects SET status=?,pr_url=?,pr_status=?,updated_at=? WHERE id=?').run('pr_validated', prUrl, checked.status, dateNow(), project.id);
            store.log('pr_validated', `Pull request validated for ${project.folder}`, project.id);
          }
        } catch (error) {
          if (error instanceof BindingError) {
            store.db.prepare('UPDATE projects SET status=?,error=?,updated_at=? WHERE id=?').run('pr_rejected', error.message, dateNow(), project.id);
            store.log('pr_rejected', error.message, project.id);
          } else store.log('poll_error', error.message, project.id);
        }
      }
      const older = store.db.prepare("SELECT * FROM projects WHERE jules_session_name IS NOT NULL AND status<>'running' AND jules_polled_at IS NULL LIMIT 10").all();
      for (const project of older) {
        try {
          saveActivities(store, project.id, project.jules_session_name, await julesFactory(julesKey()).activities(project.jules_session_name));
          store.db.prepare('UPDATE projects SET jules_polled_at=?,activity_error=NULL WHERE id=?').run(dateNow(), project.id);
        } catch (error) {
          store.db.prepare('UPDATE projects SET jules_polled_at=?,activity_error=? WHERE id=?').run(dateNow(), error.message, project.id);
          store.log('activity_poll_error', error.message, project.id);
        }
      }
      for (const project of validated) {
        try {
          const binding = store.binding();
          if (project.binding_identity !== `${binding.github_repository_id}|${binding.jules_source_id}|${binding.base_branch}`) continue;
          verifyProjectBinding([project], binding);
          const checked = await validatePullRequest(project.pr_url, project, binding, githubFactory(githubToken()));
          store.db.prepare('UPDATE projects SET pr_status=?,updated_at=? WHERE id=?').run(checked.status, dateNow(), project.id);
        } catch (error) {
          if (error instanceof BindingError) {
            store.db.prepare('UPDATE projects SET status=?,error=?,updated_at=? WHERE id=?').run('pr_rejected', error.message, dateNow(), project.id);
            store.log('pr_rejected', error.message, project.id);
          } else store.log('pr_status_error', error.message, project.id);
        }
      }
    } finally {
      pollingBusy = false;
      if (!closed) { await schedule(); await runOrchestrator(); }
    }
  }

  // An interrupted request may have reached Jules; never retry it blindly.
  store.db.prepare("UPDATE projects SET status='blocked',error='Launch was interrupted. Inspect Jules before retrying.',updated_at=? WHERE status='launching'").run(dateNow());
  store.db.prepare("UPDATE jules_auto_replies SET status='uncertain',error='Automatic response was interrupted. Inspect Jules before replying again.',updated_at=? WHERE status='sending'").run(dateNow());
  const timer = setInterval(() => { void pollSessions(); void schedule(); void runOrchestrator(); }, 30000);
  timer.unref();
  void schedule();
  void pollSessions();
  void runOrchestrator();

  const server = createServer(async (request, response) => {
    const host = request.headers.host ?? '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) { response.writeHead(421); response.end('Local access only'); return; }
    const url = new URL(request.url, `http://${host}`);
    const path = url.pathname;
    if (request.method === 'GET' && ['/style.css','/favicon.svg','/favicon-dark.svg'].includes(path)) {
      const file = readFileSync(join(import.meta.dirname, '..', 'public', path.slice(1)));
      response.writeHead(200, { 'content-type': path.endsWith('.css') ? 'text/css; charset=utf-8' : 'image/svg+xml', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(file); return;
    }
    const interfaceAssets = { '/interface.js': ['interface.js', 'text/javascript; charset=utf-8'], '/theme.js': ['theme.js', 'text/javascript; charset=utf-8'], '/fonts/fraunces.ttf': ['fonts/fraunces.ttf', 'font/ttf'], '/fonts/fraunces-italic.ttf': ['fonts/fraunces-italic.ttf', 'font/ttf'], '/fonts/manrope.ttf': ['fonts/manrope.ttf', 'font/ttf'] };
    if (request.method === 'GET' && Object.hasOwn(interfaceAssets, path)) {
      const [file, contentType] = interfaceAssets[path];
      response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
      response.end(readFileSync(join(import.meta.dirname, '..', 'public', file)));
      return;
    }
    try {
      if (request.method === 'GET') {
        if (path === '/welcome') return html(response, welcomePage({ configured: store.get('configured') === '1' && !!store.binding() }));
        if (path === '/') {
          if (store.get('configured') !== '1' || !store.binding()) return html(response, welcomePage());
          return html(response, dashboardPage({ binding: store.binding(), folders: store.remoteFolders(), projects: store.projects(), csrfToken, defaults: defaults(store), nextProjectNumber: store.nextProjectNumber(), message: url.searchParams.get('message'), error: url.searchParams.get('error') }));
        }
        if (path === '/setup') return setupView(response, { rebind: url.searchParams.has('rebind'), defaults: url.searchParams.has('defaults'), error: url.searchParams.get('error') });
        if (path === '/setup/guide') return html(response, guidePage(csrfToken));
        if (path === '/settings') {
          if (!store.binding()) return redirect(response, '/setup');
          return html(response, settingsPage({ binding: store.binding(), folders: store.remoteFolders(), projects: store.projects(), csrfToken, defaults: defaults(store), nextProjectNumber: store.nextProjectNumber(), message: url.searchParams.get('message'), error: url.searchParams.get('error') }));
        }
        if (path === '/prompt') return html(response, promptPage({ template: syncActivePrompt(store, promptPath), library: promptLibrary(store), csrfToken, configured: store.get('configured') === '1', back: store.get('configured') === '1' ? '/settings' : '/setup?defaults=1', message: url.searchParams.get('message'), error: url.searchParams.get('error') }));
        if (path === '/orchestrator') {
          if (store.get('configured') !== '1' || !store.binding()) return redirect(response, '/setup');
          return html(response, orchestratorPage({ settings: orchestratorSettings(), hasKey: !!store.getSecret('orchestrator'), csrfToken, message: url.searchParams.get('message'), error: url.searchParams.get('error'), lastError: store.get('orchestratorLastError'), lastAttempt: store.get('orchestratorLastAttempt'), retryAt: store.get('orchestratorRetryAt'), usedToday: orchestratorUsage(), concurrency: defaults(store).concurrency }));
        }
        if (path === '/activity') {
          if (store.get('configured') !== '1' || !store.binding()) return redirect(response, '/setup');
          const projects = store.projects();
          return html(response, activityPage({ projects, latest: new Map(projects.map(project => [project.id, store.latestActivity(project.id)])), defaults: defaults(store) }));
        }
        if (path === '/activity/settings') {
          if (store.get('configured') !== '1' || !store.binding()) return redirect(response, '/setup');
          const projects = store.projects();
          return html(response, agentSettingsPage({ defaults: defaults(store), csrfToken, activeCount: projects.filter(project => ['launching', 'running'].includes(project.status)).length, queuedCount: projects.filter(project => project.status === 'queued').length, message: url.searchParams.get('message'), error: url.searchParams.get('error') }));
        }
        if (/^\/projects\/[0-9a-f-]{36}$/i.test(path)) {
          const project = store.project(path.slice('/projects/'.length));
          if (!project) return html(response, layout('Not found', '<main class="narrow"><h1>Project not found</h1></main>'), 404);
          return html(response, projectPage({ project, activities: store.activities(project.id), autoReplies: store.autoReplies(project.id), csrfToken, message: url.searchParams.get('message'), error: url.searchParams.get('error') }));
        }
        if (path === '/preflight') {
          if (!store.binding()) return redirect(response, '/setup');
          const ids = idsFrom(url.searchParams);
          const projects = ids.map(id => store.project(id)).filter(Boolean);
          if (projects.length !== ids.length) throw new Error('A selected project was not found.');
          let error;
          try { await checkedProjects(ids, ['reserved']); }
          catch (cause) { error = cause.message; }
          let prompts = [];
          try {
            const template = readPromptTemplate(promptPath);
            prompts = projects.map(project => researchPrompt(project, store.binding(), defaults(store), template));
          } catch (cause) { error ||= cause.message; }
          return html(response, preflightPage({ binding: store.binding(), projects, csrfToken, valid: !error, error, prompts }));
        }
        return html(response, layout('Not found', '<main class="narrow"><h1>Page not found</h1><a href="/">Go home</a></main>'), 404);
      }
      if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
      const form = await bodyParams(request);
      if (!safeEqual(form.get('csrf'), csrfToken)) { response.writeHead(403); response.end('Invalid form token'); return; }
      if (path === '/orchestrator/settings') {
        if (store.get('configured') !== '1' || !store.binding()) return redirect(response, '/setup');
        const previous = orchestratorSettings();
        const settings = validateOrchestratorSettings({ provider: form.get('provider'), endpoint: form.get('endpoint') || NVIDIA_ENDPOINT, model: form.get('model') || NVIDIA_MODEL, brief: form.get('brief'), intervalHours: form.get('intervalHours'), dailyLimit: form.get('dailyLimit'), mode: form.get('mode') || 'scheduled' });
        const key = form.get('apiKey')?.trim();
        if (!key && (!store.getSecret('orchestrator') || previous.provider !== settings.provider || previous.endpoint !== settings.endpoint)) throw new Error('Enter an API key for this provider and endpoint.');
        if (key) store.setSecret('orchestrator', key);
        settings.enabled = form.has('enabled');
        store.set('orchestrator', JSON.stringify(settings));
        resetCooldown();
        store.log('orchestrator_settings_updated', `${settings.provider} orchestrator ${settings.enabled ? 'enabled' : 'disabled'}`);
        if (settings.enabled) void runOrchestrator();
        return redirect(response, messageUrl('/orchestrator', 'Orchestrator settings saved.'));
      }
      if (path === '/orchestrator/generate') {
        if (store.get('configured') !== '1' || !store.binding()) return redirect(response, '/setup');
        const project = await runOrchestrator(true);
        if (!project) {
          if (coolingDown()) throw new Error(`Research is paused until ${store.get('orchestratorRetryAt')}. ${store.get('orchestratorLastError') || 'A provider retry is pending.'}`);
          if (!store.getSecret('orchestrator') || !orchestratorSettings().brief) throw new Error('Save a model API key and research brief before creating a task.');
          throw new Error(`No Jules slot is available within the current capacity target of ${defaults(store).concurrency}. Check running agents or increase the target under Agent settings.`);
        }
        return redirect(response, messageUrl(`/projects/${project.id}`, 'Research task created and queued.'));
      }
      if (path === '/prompt') {
        try {
          if (form.get('action') === 'save-as') {
            const preset = savePromptAsNew(store, form.get('promptName'), form.get('promptTemplate'), promptPath);
            store.log('prompt_created', `Saved and selected prompt ${preset.name}`);
            return redirect(response, messageUrl('/prompt', `Saved and selected “${preset.name}”. New launches will use it.`));
          }
          saveActivePrompt(store, form.get('promptTemplate'), promptPath);
          store.log('prompt_updated', 'Active prompt template updated');
          return redirect(response, messageUrl('/prompt', 'Prompt saved. New launches will use this version.'));
        } catch (error) {
          return html(response, promptPage({ template: form.get('promptTemplate') ?? '', promptName: form.get('promptName') ?? '', library: promptLibrary(store), csrfToken, configured: store.get('configured') === '1', back: store.get('configured') === '1' ? '/settings' : '/setup?defaults=1', error: error.message }), 422);
        }
      }
      if (path === '/prompt/activate') {
        const preset = activatePrompt(store, form.get('promptId'), promptPath);
        store.log('prompt_activated', `Selected prompt ${preset.name}`);
        return redirect(response, messageUrl('/prompt', `Selected “${preset.name}”. New launches will use it.`));
      }
      if (path === '/setup/jules') {
        const key = form.get('julesKey')?.trim();
        if (!key) throw new Error('Enter a Jules API key.');
        const sources = await discoverSources(key, { jules: julesFactory(key) });
        store.setSecret('jules', key);
        resetCooldown();
        store.log('jules_connected', `Jules authenticated; ${sources.length} repositories discovered`);
        return redirect(response, sources.length ? '/setup' : messageUrl('/setup', 'Authentication succeeded, but no repositories are accessible. Connect one in Jules and retry.', 'error'));
      }
      if (path === '/setup/refresh-sources') return redirect(response, form.get('rebind') ? '/setup?rebind=1' : '/setup');
      if (path === '/setup/repository') {
        const sourceName = form.get('sourceName') ?? '';
        const sources = await listSources();
        const selected = sources.find(source => source.name === sourceName);
        const owner = (selected?.githubRepo?.owner || form.get('owner')?.trim() || '').trim();
        const repo = (selected?.githubRepo?.repo || form.get('repo')?.trim() || '').trim();
        const branch = form.get('branchChoice') || form.get('branch')?.trim() || 'main';
        const token = form.get('githubToken')?.trim() || githubToken();
        const prefill = { owner, repo, branch, sourceName };
        try {
          if (store.db.prepare("SELECT COUNT(*) AS n FROM projects WHERE status IN ('queued','launching','running')").get().n) throw new BindingError('Finish active Jules tasks before changing the repository.');
          const result = await verifyRepository({ julesKey: julesKey(), githubToken: token, owner, repo, branch, sourceName: selected?.name }, { jules: julesFactory(julesKey()), github: githubFactory(token) });
          store.setSecret('github', token);
          store.saveBinding(result);
          store.replaceRemoteFolders(result.folders);
          resetCooldown();
          store.set('orchestratorLastAttempt', '');
          store.log('binding_created', `Bound ${result.fullName} on ${result.branch} to ${result.sourceName}`);
          if (form.has('rebind') && store.get('configured') === '1') void runOrchestrator();
          return redirect(response, form.has('rebind') && store.get('configured') === '1' ? messageUrl('/settings', 'Repository connection verified and updated.') : '/setup');
        } catch (error) {
          return setupView(response, { error: error.message, branches: error.details?.branches, prefill, rebind: form.has('rebind') });
        }
      }
      if (path === '/setup/defaults') {
        if (!store.binding()) throw new Error('Connect a repository first.');
        saveDefaults(store, parseDefaults(form)); store.set('configured', '1');
        store.log('setup_completed', 'Setup completed');
        void runOrchestrator();
        return redirect(response, messageUrl('/', 'Setup complete. The repository is ready.'));
      }
      if (path === '/activity/settings') {
        if (store.get('configured') !== '1' || !store.binding()) return redirect(response, '/setup');
        saveDefaults(store, parseDefaults(form));
        if (form.has('autoReplyPresent')) store.set('autoReply', form.has('autoReply') ? '1' : '0');
        store.log('agent_settings_updated', 'Agent runtime, seeds, and concurrency updated');
        void schedule();
        void runOrchestrator();
        return redirect(response, messageUrl('/activity/settings', 'Agent settings saved. Queued tasks will use the new limit.'));
      }
      if (path === '/settings/refresh') {
        await refresh();
        return redirect(response, messageUrl('/settings', 'Jules, GitHub, branch and numbered folders verified.'));
      }
      if (path === '/settings/jules') {
        if (store.get('configured') !== '1' || !store.binding()) return redirect(response, '/setup');
        const key = form.get('julesKey')?.trim();
        if (!key) throw new Error('Enter a Jules API key.');
        // Check the existing repository with the replacement key before saving it.
        const binding = store.binding();
        await verifyRepository({ julesKey: key, githubToken: githubToken(), owner: binding.github_owner, repo: binding.github_repo, branch: binding.base_branch, sourceName: binding.jules_source_id, expectedGithubId: binding.github_repository_id }, { jules: julesFactory(key), github: githubFactory(githubToken()) });
        store.setSecret('jules', key);
        resetCooldown();
        store.log('jules_key_updated', 'Verified and updated the Jules API key');
        void schedule();
        void runOrchestrator();
        return redirect(response, messageUrl('/settings', 'Jules key verified and updated. Automatic research can resume.'));
      }
      if (path === '/settings/test') {
        await verifyBinding(store, deps());
        return redirect(response, messageUrl('/settings', 'Jules and GitHub connections, repository identity and branch verified.'));
      }
      if (path === '/settings/next-number') {
        const number = Number(form.get('nextProjectNumber'));
        if (!Number.isSafeInteger(number) || number < 1 || number > 1000000) throw new Error('Enter a next project number from 1 to 1,000,000.');
        await refresh();
        const next = store.setNextProjectNumber(number);
        return redirect(response, messageUrl('/settings', `The next available project number is ${next}.`));
      }
      if (path === '/projects/reserve') {
        if (store.get('configured') !== '1') return redirect(response, '/setup');
        const topics = (form.get('topics') ?? '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
        if (!topics.length || topics.length > 50 || topics.some(item => item.length > 300)) throw new Error('Enter 1–50 topics, one per line.');
        await refresh();
        const projects = store.reserve(topics);
        for (const project of projects) store.log('reserved', `Reserved ${project.folder}`, project.id);
        return redirect(response, selectionUrl(projects.map(project => project.id)));
      }
      if (path === '/projects/remove') {
        const id = form.get('projectId') ?? '';
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid project ID.');
        const removed = store.removeReservation(id);
        return redirect(response, messageUrl('/', `${removed.folder} reservation removed.`));
      }
      if (path === '/projects/clear') {
        if (store.get('configured') !== '1') return redirect(response, '/setup');
        const category = form.get('category');
        const count = store.clearProjects(category);
        const label = { finished: 'finished', reserved: 'reserved', failed: 'failed', stopped: 'stopped' }[category];
        return redirect(response, messageUrl('/', `${count} ${label} local project${count === 1 ? '' : 's'} cleared.`));
      }
      const sessionAction = path.match(/^\/projects\/([0-9a-f-]{36})\/(approve-plan|reply)$/i);
      const stopAction = path.match(/^\/projects\/([0-9a-f-]{36})\/stop$/i);
      if (stopAction) {
        const projectId = stopAction[1];
        const destination = `/projects/${projectId}`;
        const project = store.project(projectId);
        if (!project || !['queued', 'running'].includes(project.status)) return redirect(response, messageUrl(destination, 'This project is not queued or running.', 'error'));
        if (project.status === 'running' && project.jules_session_name) {
          try { await julesFactory(julesKey()).deleteSession(project.jules_session_name); }
          catch (error) { if (error.status !== 404) return redirect(response, messageUrl(destination, error.message, 'error')); }
        }
        const now = dateNow();
        store.db.prepare("UPDATE projects SET status='stopped',jules_state='STOPPED',error='Stopped by user.',updated_at=? WHERE id=? AND status IN ('queued','running')").run(now, projectId);
        store.log('session_stopped', `Stopped ${project.folder}; repository slot released`, projectId);
        return redirect(response, messageUrl(destination, 'Task stopped. You can now change the repository.'));
      }
      if (sessionAction) {
        const [, projectId, action] = sessionAction;
        const destination = `/projects/${projectId}`;
        const project = store.project(projectId);
        if (!project || project.status !== 'running' || !/^sessions\/[a-zA-Z0-9_-]+$/.test(project.jules_session_name ?? '')) {
          return redirect(response, messageUrl(destination, 'This project has no active Jules session.', 'error'));
        }
        if (sessionRepliesInFlight.has(projectId)) return redirect(response, messageUrl(destination, 'A response is already being sent. Refresh the session before trying again.', 'error'));
        const reply = form.get('reply')?.trim();
        if (action === 'reply' && (!reply || reply.length > 10000)) return redirect(response, messageUrl(destination, 'Enter a reply of 1–10,000 characters.', 'error'));
        sessionRepliesInFlight.add(projectId);
        try {
          const jules = julesFactory(julesKey());
          const session = await jules.session(project.jules_session_name);
          if (action === 'approve-plan') {
            if (session.state !== 'AWAITING_PLAN_APPROVAL') throw new Error('Jules is no longer waiting for plan approval. Refresh the project.');
            await jules.approvePlan(project.jules_session_name);
            const plan = store.db.prepare("SELECT name FROM jules_activities WHERE project_id=? AND kind='plan' AND summary='Plan generated' ORDER BY created_at DESC,name DESC LIMIT 1").get(projectId);
            if (plan) {
              const now = dateNow();
              store.db.prepare("INSERT INTO jules_auto_replies(activity_name,project_id,status,created_at,updated_at) VALUES (?,?,'manual',?,?) ON CONFLICT(activity_name) DO UPDATE SET status='manual',error=NULL,updated_at=excluded.updated_at").run(plan.name, projectId, now, now);
            }
            store.log('plan_approved', `Approved Jules plan for ${project.folder}`, projectId);
          } else {
            if (!['AWAITING_USER_FEEDBACK', 'PAUSED'].includes(session.state)) throw new Error('Jules is no longer waiting for a reply. Refresh the project.');
            await jules.sendMessage(project.jules_session_name, reply);
            const question = store.db.prepare("SELECT name FROM jules_activities WHERE project_id=? AND kind='message' AND originator='agent' ORDER BY created_at DESC,name DESC LIMIT 1").get(projectId);
            if (question) {
              const now = dateNow();
              store.db.prepare("INSERT INTO jules_auto_replies(activity_name,project_id,status,created_at,updated_at) VALUES (?,?,'manual',?,?) ON CONFLICT(activity_name) DO UPDATE SET status='manual',error=NULL,updated_at=excluded.updated_at").run(question.name, projectId, now, now);
            }
            store.log('feedback_sent', `Sent a reply to Jules for ${project.folder}`, projectId);
          }
          return redirect(response, messageUrl(destination, action === 'approve-plan' ? 'Plan approved. Jules should continue shortly.' : 'Reply sent to Jules. Check the session for its next update.'));
        } catch (error) {
          return redirect(response, messageUrl(destination, error.message, 'error'));
        } finally {
          sessionRepliesInFlight.delete(projectId);
        }
      }
      if (path === '/projects/launch') {
        const ids = idsFrom(form);
        await launchResearchBatch(ids);
        return redirect(response, messageUrl('/', `${ids.length} task${ids.length === 1 ? '' : 's'} queued. Jules sessions will start within the concurrency limit.`));
      }
      return html(response, layout('Not found', '<main class="narrow"><h1>Page not found</h1></main>'), 404);
    } catch (error) {
      const destination = path.startsWith('/setup') ? '/setup' : path.startsWith('/settings') ? '/settings' : path.startsWith('/orchestrator') ? '/orchestrator' : path === '/activity/settings' ? '/activity/settings' : '/';
      redirect(response, messageUrl(destination, error.message, 'error'));
    }
  });
  return { server, close: () => { closed = true; clearInterval(timer); server.close(); }, launchResearchProject, launchResearchBatch, pollSessions, schedule, runOrchestrator };
}
