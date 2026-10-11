import { verifyBinding, verifyReservations, verifyProjectBinding, researchPrompt, validatePullRequest, bindingIdentity, BindingError } from './core.mjs';
import { readPromptTemplate } from './prompt.mjs';
import { saveActivities } from './activities.mjs';
import { proposeResearch } from './orchestrator.mjs';
import { recordPacket, flowSnapshot } from './flow.mjs';
import { defaults } from './settings.mjs';
import { transaction } from './store-schema.mjs';
import { createAutoReplies } from './auto-replies.mjs';

const dateNow = () => new Date().toISOString();

// Owns task scheduling, provider retries, activity polling, and automatic decisions.
export function createResearchCoordinator(store, services) {
  const { julesKey, githubToken, deps, orchestratorSettings, julesFactory, githubFactory, orchestratorFactory, promptPath } = services;
  let schedulerBusy = false;
  let schedulerRerunRequested = false;
  let schedulerPromise;
  let pollingBusy = false;
  let orchestratorBusy = false;
  let closed = false;
  const orchestratorUsage = () => Number(store.get('orchestratorDay') === dateNow().slice(0, 10) ? store.get('orchestratorCount') ?? 0 : 0);
  let modelRequests = 0;
  let capacityCheckedAt = null;
  let accountActive = null;
  const modelClient = (projectId = null) => {
    const client = orchestratorFactory({ ...orchestratorSettings(), apiKey: store.getSecret('orchestrator') });
    const packetIds = [];
    const wrapped = async (system, user) => {
      packetIds.push(recordPacket(store, { projectId, from: 'coordinator', to: 'model', kind: 'request', title: projectId ? 'Requesting a research decision' : 'Requesting a task plan', content: `System instructions\n${system}\n\nTask context\n${user}` }));
      modelRequests++;
      try {
        const answer = await client(system, user);
        packetIds.push(recordPacket(store, { projectId, from: 'model', to: 'coordinator', kind: 'response', title: projectId ? 'Model decision received' : 'Task plan received', content: JSON.stringify(answer, null, 2) }));
        return answer;
      } catch (error) {
        recordPacket(store, { projectId, from: 'model', to: 'coordinator', kind: 'error', title: 'Model request failed', content: error.message });
        throw error;
      } finally { modelRequests--; }
    };
    wrapped.packetIds = packetIds;
    return wrapped;
  };
  const atDailyLimit = () => {
    const limit = orchestratorSettings().dailyLimit;
    return limit > 0 && orchestratorUsage() >= limit;
  };
  const coolingDown = () => Date.parse(store.get('orchestratorRetryAt') ?? '') > Date.now();
  const continuous = () => {
    const settings = orchestratorSettings();
    return settings.enabled && settings.mode === 'continuous';
  };
  const { autoReplyToFeedback, autoApprovePlan } = createAutoReplies(store, { continuous, orchestratorSettings, modelClient, isClosed: () => closed });

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
    const projects = store.db.prepare(`SELECT * FROM projects WHERE status IN ('launching','running','stopping'${includeQueued ? ",'queued'" : ''})`).all();
    const names = new Set(projects.map(project => project.jules_session_name).filter(Boolean));
    const client = julesFactory(julesKey());
    // Include tasks started outside this app; Jules owns the account-wide quota.
    const sessions = client.sessions ? await client.sessions() : [];
    const external = sessions.filter(session => !['COMPLETED', 'FAILED', 'STOPPED'].includes(session.state) && !names.has(session.name));
    const remoteByName = new Map(sessions.map(session => [session.name, session]));
    const localActive = projects.filter(project => !['COMPLETED', 'FAILED', 'STOPPED'].includes(remoteByName.get(project.jules_session_name)?.state));
    capacityCheckedAt = dateNow();
    accountActive = localActive.length + external.length;
    return accountActive;
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
      if (closed) return;
      const current = store.project(projectId);
      verifyProjectBinding([current], store.binding());
      const claimed = store.db.prepare('UPDATE projects SET status=?,updated_at=? WHERE id=? AND status=?').run('launching', dateNow(), projectId, 'queued');
      if (claimed.changes !== 1) return;
      store.log('launching', `Starting ${current.folder} in ${binding.github_full_name}`, projectId);
      const prompt = researchPrompt(current, binding, defaults(store), readPromptTemplate(promptPath));
      store.db.prepare('UPDATE projects SET prompt_text=? WHERE id=?').run(prompt, projectId);
      submitted = true;
      recordPacket(store, { projectId, from: current.orchestrator_instructions ? 'model' : 'coordinator', to: 'jules', kind: 'dispatch', title: `Sending task: ${current.topic}`, content: prompt });
      const session = await julesFactory(julesKey()).createSession({ prompt, title: `${current.folder}: ${current.topic}`.slice(0, 100), sourceName: binding.jules_source_id, branch: binding.base_branch });
      if (!/^sessions\/[a-zA-Z0-9_-]+$/.test(session.name ?? '')) throw new Error('Jules returned no valid session identifier. Check Jules before retrying.');
      const url = /^https:\/\/jules\.google\.com\//.test(session.url ?? '') ? session.url : null;
      store.db.prepare('UPDATE projects SET status=?,jules_state=?,jules_session_name=?,jules_session_url=?,error=NULL,updated_at=? WHERE id=?').run('running', session.state || 'QUEUED', session.name, url, dateNow(), projectId);
      store.log('session_created', `${session.name} launched for ${current.folder}`, projectId);
      recordPacket(store, { projectId, from: 'jules', to: 'coordinator', kind: 'response', title: 'Jules accepted the task', content: `Session: ${session.name}\nState: ${session.state || 'QUEUED'}` });
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
      const changed = store.db.prepare("UPDATE projects SET status=?,error=?,updated_at=? WHERE id=? AND status IN ('queued','launching')").run(retryable ? 'queued' : 'blocked', error.message, dateNow(), projectId);
      if (!changed.changes) return;
      store.log(retryable ? 'launch_deferred' : 'launch_blocked', error.message, projectId);
      recordPacket(store, { projectId, from: 'jules', to: 'coordinator', kind: 'error', title: retryable ? 'Launch deferred' : 'Launch blocked', content: error.message });
      deferResearch(error);
    }
  }

  async function launchResearchBatch(ids) {
    const projects = await checkedProjects(ids, ['reserved']);
    transaction(store.db, () => {
      const update = store.db.prepare('UPDATE projects SET status=?,updated_at=? WHERE id=? AND status=?');
      for (const project of projects) {
        if (update.run('queued', dateNow(), project.id, 'reserved').changes !== 1) throw new Error('Project reservation changed during launch.');
        store.log('queued', `Queued ${project.folder}`, project.id);
      }
    });
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
      const pending = store.db.prepare("SELECT COUNT(*) AS n FROM projects WHERE status IN ('reserved','queued','launching','running','stopping')").get().n;
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
        const recentTopics = store.db.prepare('SELECT topic FROM projects ORDER BY number_generation DESC,folder_number DESC LIMIT 30').all().map(project => project.topic);
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
        for (const packetId of planningClient.packetIds) store.db.prepare('UPDATE agent_packets SET project_id=? WHERE id=?').run(project.id, packetId);
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

  async function pollSessions() {
    if (pollingBusy) return;
    pollingBusy = true;
    try {
      // Open reports are checked every five minutes; closed/merged reports daily.
      // Limit each batch so a large library cannot monopolize provider traffic.
      const validated = store.db.prepare(`SELECT id FROM projects WHERE status='pr_validated' AND binding_identity=? AND
        (pr_checked_at IS NULL OR pr_checked_at <= CASE WHEN pr_status IN ('merged','closed') THEN ? ELSE ? END)
        ORDER BY COALESCE(pr_checked_at,'') LIMIT 10`).all(
        store.binding() ? bindingIdentity(store.binding()) : '', new Date(Date.now() - 86400000).toISOString(), new Date(Date.now() - 300000).toISOString());
      const running = store.db.prepare("SELECT * FROM projects WHERE status='running'").all();
      for (const project of running) {
        try {
          const jules = julesFactory(julesKey());
          const session = await jules.session(project.jules_session_name);
          if (closed || store.project(project.id)?.status !== 'running') continue;
          if (session.state && session.state !== project.jules_state) recordPacket(store, { projectId: project.id, from: 'jules', to: 'coordinator', kind: 'state', title: 'Jules state changed', content: session.state.replaceAll('_', ' ') });
          store.db.prepare('UPDATE projects SET jules_state=?,jules_polled_at=? WHERE id=?').run(session.state || 'STATE_UNSPECIFIED', dateNow(), project.id);
          try {
            const activities = await jules.activities(project.jules_session_name);
            if (closed || store.project(project.id)?.status !== 'running') continue;
            saveActivities(store, project.id, project.jules_session_name, activities);
            store.db.prepare('UPDATE projects SET activity_error=NULL WHERE id=?').run(project.id);
            if (session.state === 'AWAITING_PLAN_APPROVAL') await autoApprovePlan(project, jules, activities);
            if (['AWAITING_USER_FEEDBACK', 'PAUSED'].includes(session.state)) await autoReplyToFeedback(project, jules, activities);
          } catch (activityError) {
            store.db.prepare('UPDATE projects SET activity_error=? WHERE id=?').run(activityError.message, project.id);
            store.log('activity_poll_error', activityError.message, project.id);
          }
          if (closed || store.project(project.id)?.status !== 'running') continue;
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
            if (closed || store.project(project.id)?.status !== 'running') continue;
            store.db.prepare('UPDATE projects SET status=?,pr_url=?,pr_status=?,pr_checked_at=?,pr_head_sha=?,pr_base_sha=?,pr_file_count=?,updated_at=? WHERE id=?')
              .run('pr_validated', prUrl, checked.status, dateNow(), checked.headSha, checked.baseSha, checked.files, dateNow(), project.id);
            store.log('pr_validated', `Pull request validated for ${project.folder}`, project.id);
            recordPacket(store, { projectId: project.id, from: 'jules', to: 'repository', kind: 'report', title: 'Report pull request validated', content: prUrl });
          }
        } catch (error) {
          if (closed || store.project(project.id)?.status !== 'running') continue;
          if (error instanceof BindingError) {
            store.db.prepare('UPDATE projects SET status=?,pr_status=NULL,pr_head_sha=NULL,pr_base_sha=NULL,pr_file_count=NULL,error=?,updated_at=? WHERE id=?').run('pr_rejected', error.message, dateNow(), project.id);
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
        if (closed) break;
        try { await refreshReport(project.id); }
        catch (error) { store.log('pr_status_error', error.message, project.id); }
      }
    } finally {
      pollingBusy = false;
      if (!closed) { await schedule(); await runOrchestrator(); }
    }
  }

  async function refreshReport(projectId, { force = false } = {}) {
    const project = store.project(projectId), binding = store.binding();
    if (!project || project.status !== 'pr_validated' || !binding || project.binding_identity !== bindingIdentity(binding)) throw new Error('This report does not belong to the currently connected repository and branch.');
    // Persist attempts too, so an unavailable provider is not hammered every tick.
    store.db.prepare('UPDATE projects SET pr_checked_at=? WHERE id=?').run(dateNow(), projectId);
    try {
      const checked = await validatePullRequest(project.pr_url, project, binding, githubFactory(githubToken()), { useCache: !force });
      if (closed || store.project(projectId)?.status !== 'pr_validated') return;
      store.db.prepare('UPDATE projects SET pr_status=?,pr_head_sha=?,pr_base_sha=?,pr_file_count=?,updated_at=? WHERE id=?')
        .run(checked.status, checked.headSha, checked.baseSha, checked.files, dateNow(), projectId);
    } catch (error) {
      if (error instanceof BindingError && store.project(projectId)?.status === 'pr_validated') {
        store.db.prepare("UPDATE projects SET status='pr_rejected',pr_status=NULL,pr_head_sha=NULL,pr_base_sha=NULL,pr_file_count=NULL,error=?,updated_at=? WHERE id=?").run(error.message, dateNow(), projectId);
        store.log('pr_rejected', error.message, projectId);
      }
      throw error;
    }
  }

  function matchesLaunch(project, session) {
    const binding = store.binding();
    return !!project.prompt_text && session.prompt === project.prompt_text &&
      session.sourceContext?.source === binding.jules_source_id &&
      session.sourceContext?.githubRepoContext?.startingBranch === binding.base_branch;
  }

  function recoverableProject(projectId) {
    const project = store.project(projectId);
    if (!project || project.status !== 'blocked' || project.jules_session_name) throw new Error('Only an interrupted or blocked launch without a saved session can be recovered.');
    verifyProjectBinding([project], store.binding());
    return project;
  }

  async function inspectRecovery(projectId) {
    const project = recoverableProject(projectId);
    const sessions = await julesFactory(julesKey()).sessions();
    return { project, sessions: sessions.filter(session => matchesLaunch(project, session)) };
  }

  async function recoverProject(projectId, { action, sessionName, noSession = false }) {
    const project = recoverableProject(projectId);
    const jules = julesFactory(julesKey());
    await verifyBinding(store, deps());
    if (action === 'attach') {
      const session = await jules.session(sessionName);
      if (session?.name !== sessionName || !/^sessions\/[a-zA-Z0-9_-]+$/.test(sessionName ?? '') || !matchesLaunch(project, session)) {
        throw new Error('This Jules session does not match the saved prompt, repository and branch.');
      }
      if (store.db.prepare('SELECT id FROM projects WHERE jules_session_name=? AND id<>?').get(sessionName, projectId)) throw new Error('This Jules session is already connected to another project.');
      recoverableProject(projectId);
      const url = /^https:\/\/jules\.google\.com\//.test(session.url ?? '') ? session.url : null;
      const changed = store.db.prepare("UPDATE projects SET status='running',jules_state=?,jules_session_name=?,jules_session_url=?,jules_polled_at=NULL,error=NULL,updated_at=? WHERE id=? AND status='blocked' AND jules_session_name IS NULL")
        .run(session.state || 'QUEUED', sessionName, url, dateNow(), projectId);
      if (!changed.changes) throw new Error('The project changed during recovery. Refresh and try again.');
      store.log('session_recovered', `Reconnected ${sessionName} to ${project.folder}`, projectId);
    } else if (action === 'retry') {
      if (!noSession) throw new Error('Inspect Jules and confirm that no existing session is doing this task before retrying.');
      const sessions = await jules.sessions();
      if (sessions.some(session => matchesLaunch(project, session))) throw new Error('Jules already has a matching session. Reconnect it instead of creating another.');
      await checkedProjects([projectId], ['blocked']);
      recoverableProject(projectId);
      const changed = store.db.prepare("UPDATE projects SET status='reserved',jules_state=NULL,error=NULL,updated_at=? WHERE id=? AND status='blocked' AND jules_session_name IS NULL").run(dateNow(), projectId);
      if (!changed.changes) throw new Error('The project changed during recovery. Refresh and try again.');
      store.log('launch_recovered', `Returned ${project.folder} to launch review after checking Jules`, projectId);
    } else throw new Error('Choose reconnect or retry.');
  }

  // An interrupted request may have reached Jules; never retry it blindly.
  store.db.prepare("UPDATE projects SET status='blocked',error='Launch was interrupted. Inspect Jules before retrying.',updated_at=? WHERE status='launching'").run(dateNow());
  store.db.prepare("UPDATE jules_auto_replies SET status='uncertain',error='Automatic response was interrupted. Inspect Jules before replying again.',updated_at=? WHERE status='sending'").run(dateNow());
  store.db.prepare("UPDATE projects SET error='Stopping was interrupted. Inspect Jules, then use Stop task again if needed.',updated_at=? WHERE status='stopping'").run(dateNow());
  const timer = setInterval(() => { void pollSessions(); void schedule(); void runOrchestrator(); }, 30000);
  timer.unref();
  void schedule();
  void pollSessions();
  void runOrchestrator();


  return {
    launchResearchProject, launchResearchBatch, pollSessions, schedule, runOrchestrator,
    refresh, refreshReport, inspectRecovery, recoverProject, checkedProjects, resetCooldown, coolingDown, orchestratorUsage,
    snapshot: () => ({ ...flowSnapshot(store, { modelBusy: modelRequests > 0 }), capacityCheckedAt, accountActive }),
    projectSnapshot: projectId => flowSnapshot(store, { projectId, modelBusy: modelRequests > 0 }),
    close() { closed = true; clearInterval(timer); },
  };
}
