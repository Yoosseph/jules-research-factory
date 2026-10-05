import { discoverSources, verifyRepository, verifyBinding, researchPrompt, BindingError } from './core.mjs';
import { setupPage, dashboardPage, preflightPage, settingsPage, guidePage, layout } from './ui.mjs';
import { promptPage, activityPage, agentSettingsPage, projectPage, orchestratorPage } from './work-ui.mjs';
import { readPromptTemplate, syncActivePrompt, promptLibrary, saveActivePrompt, savePromptAsNew, activatePrompt } from './prompt.mjs';
import { NVIDIA_ENDPOINT, NVIDIA_MODEL, validateOrchestratorSettings } from './orchestrator.mjs';
import { welcomePage } from './landing-ui.mjs';
import { recordPacket } from './flow.mjs';
import { flowPage } from './flow-ui.mjs';
import { defaults, parseDefaults, saveDefaults } from './settings.mjs';
import { html, redirect, safeEqual, bodyParams, idsFrom, messageUrl, selectionUrl, serveAsset } from './http.mjs';

const dateNow = () => new Date().toISOString();

// Routes translate browser requests into coordinator/store operations.
export function createRequestHandler(store, services, coordinator, flowStream, csrfToken) {
  const { julesKey, githubToken, deps, orchestratorSettings, julesFactory, githubFactory, promptPath } = services;
  const { refresh, checkedProjects, resetCooldown, coolingDown, orchestratorUsage, launchResearchBatch, schedule, runOrchestrator } = coordinator;
  const sessionRepliesInFlight = new Set();
  const listSources = async () => julesKey() ? discoverSources(julesKey(), { jules: julesFactory(julesKey()) }) : [];

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

  return async (request, response) => {
    const host = request.headers.host ?? '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) { response.writeHead(421); response.end('Local access only'); return; }
    const url = new URL(request.url, `http://${host}`);
    const path = url.pathname;
    if (serveAsset(request, response, path)) return;
    try {
      if (request.method === 'GET') {
        if (['/flow', '/api/flow', '/api/flow/stream'].includes(path)) {
          if (store.get('configured') !== '1' || !store.binding()) return redirect(response, '/setup');
          if (path === '/flow') return html(response, flowPage());
          if (path === '/api/flow/stream') {
            flowStream.attach(response);
            return;
          }
          const projectId = url.searchParams.get('project');
          if (projectId && !store.project(projectId)) { response.writeHead(404); response.end('Task not found'); return; }
          response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          response.end(JSON.stringify(coordinator.projectSnapshot(projectId)));
          return;
        }
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
            recordPacket(store, { projectId, from: 'coordinator', to: 'jules', kind: 'reply', title: 'Manual reply accepted', content: reply });
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
  };
}
