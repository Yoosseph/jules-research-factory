import { layout, esc } from './ui.mjs';
import { icon } from './icons.mjs';
import { NVIDIA_MODEL } from './orchestrator.mjs';

const date = value => new Date(value).toLocaleString('en-GB');

export function orchestratorPage({ settings, hasKey, csrfToken, message, error, lastError, lastAttempt, retryAt, usedToday, concurrency }) {
  const provider = settings.provider ?? 'nvidia';
  const mode = settings.mode ?? (settings.provider ? 'scheduled' : 'continuous');
  const limit = settings.dailyLimit ?? 0;
  const status = !settings.enabled ? 'Off' : lastError ? 'Waiting to retry' : mode === 'continuous' ? 'Continuous' : 'Scheduled';
  const section = (number, title) => `<div class="section-label"><span>${number} /</span><h2>${title}</h2></div>`;
  return layout('Research orchestrator', `<main class="orchestrator-page">
    <div class="page-heading"><div><h1>Research orchestrator</h1><p class="lead">Your model plans research tasks. Jules runs them and submits reports to your repository.</p></div><a class="text-link" href="/activity">View agents ${icon('arrow-up-right')}</a></div>
    ${error ? `<div class="notice" role="alert">${esc(error)}</div>` : ''}
    ${message ? `<div class="notice success" role="status">${esc(message)}</div>` : ''}
    ${lastError ? `<div class="notice" role="alert"><strong>Research is waiting.</strong> ${esc(lastError)}${retryAt ? ` Automatic retry: ${esc(date(retryAt))}.` : ''}${lastError.startsWith('Jules:') && /key|token/i.test(lastError) ? ' Update your Jules key under Connection: Update Jules key. The NVIDIA key is separate. <a href="/settings#jules-key">Update Jules key</a>' : ''}</div>` : ''}
    <div class="metrics orchestrator-metrics"><div><span>Research status</span><strong>${esc(status)}</strong></div><div><span>Tasks launched today (UTC)</span><strong>${esc(usedToday)} / ${limit === 0 ? 'No app cap' : esc(limit)}</strong></div><div><span>Jules slots target</span><strong>${esc(concurrency)}</strong></div><div><span>Last attempt</span><strong>${esc(lastAttempt ? date(lastAttempt) : 'Not yet')}</strong></div></div>
    <div class="orchestrator-layout">
      <form id="orchestrator-settings" method="post" action="/orchestrator/settings" class="form-card orchestrator-form">
        <input type="hidden" name="csrf" value="${esc(csrfToken)}">
        <section class="config-section" aria-label="Research direction">
          ${section('01', 'Research brief')}
          <p class="help">Describe the subjects, priorities, and sources for new research tasks.</p>
          <label for="brief">Research direction</label><textarea id="brief" name="brief" rows="7" maxlength="4000" required placeholder="Explore emerging markets. Find underserved customer needs, compare competitors and pricing, and identify promising opportunities. Choose your own scope, cite public sources, and keep going.">${esc(settings.brief ?? '')}</textarea>
          
        </section>
        <section class="config-section" aria-label="Research model">
          ${section('02', 'Model connection')}
          <div class="field-grid"><div><label for="provider">Model provider</label><select id="provider" name="provider"><option value="nvidia" ${provider === 'nvidia' ? 'selected' : ''}>NVIDIA API Catalog</option><option value="compatible" ${provider === 'compatible' ? 'selected' : ''}>Other OpenAI-compatible provider</option></select></div><div><label for="model">Model ID</label><input id="model" name="model" value="${esc(settings.model ?? NVIDIA_MODEL)}" maxlength="160" required></div></div>
          <div data-compatible-endpoint><label for="endpoint">Other provider endpoint</label><input id="endpoint" name="endpoint" type="url" value="${esc(provider === 'compatible' ? settings.endpoint : '')}" placeholder="https://provider.example/v1/chat/completions"><p class="help">Use the full chat completions URL. NVIDIA uses its official endpoint automatically.</p></div>
          <label for="apiKey">Model provider API key</label><input id="apiKey" name="apiKey" type="password" autocomplete="off" placeholder="${hasKey ? 'Leave blank to keep the saved key' : 'Paste your model provider key'}">
          <p class="help">${hasKey ? 'A key is saved and encrypted locally. Enter a new one to replace it.' : 'Your key is encrypted locally and never displayed again.'} Jules uses a separate key under <a href="/settings#jules-key">Connection</a>.</p>
        </section>
        <section class="config-section" aria-label="Launch settings">
          ${section('03', 'Launch settings')}
          <label for="mode">Research mode</label><select id="mode" name="mode"><option value="continuous" ${mode === 'continuous' ? 'selected' : ''}>Continuous - fill available Jules slots</option><option value="scheduled" ${mode === 'scheduled' ? 'selected' : ''}>Scheduled - one task when all agents are idle</option></select>
          <div class="mode-note">Continuous research makes routine decisions and answers new Jules questions automatically, without the three-reply limit.  <a href="/activity/settings">Adjust agent capacity</a>.</div>
          <div class="field-grid"><div><label for="dailyLimit">App cap: new tasks per UTC day</label><input id="dailyLimit" name="dailyLimit" type="number" min="0" max="1000" value="${esc(limit)}" required><p class="help">Use 0 for no app cap. Jules still enforces your account quota.</p></div><div data-scheduled-interval><label for="intervalHours">Hours between scheduled attempts</label><input id="intervalHours" name="intervalHours" type="number" min="1" max="24" value="${esc(settings.intervalHours ?? 6)}" required><p class="help">Used only in scheduled mode.</p></div></div>
        </section>
        <div class="form-bottom"><button class="primary">Save orchestrator ${icon('arrow-right')}</button></div>
      </form>
      <aside class="run-aside" aria-label="Research controls">
        <div class="run-card"><h2>Automatic research</h2><p>Enable automatic creation to launch new tasks as slots become available.</p><button class="primary" form="orchestrator-settings">Save &amp; apply ${icon('arrow-up-right')}</button><label class="check-option"><input name="enabled" form="orchestrator-settings" type="checkbox" value="1" ${settings.enabled ? 'checked' : ''}><span>Automatically create and launch research</span></label></div>
        <ul class="run-details"><li>${icon('workflow')}<span>Available slots are checked every 30 seconds.</span></li><li>${icon('shield-check')}<span>Research stays within its assigned repository folder.</span></li><li>${icon('book-open')}<span>Reports are submitted as pull requests.</span></li></ul>
        <p class="help">Keep this app and computer running. Quota or provider errors pause launches and retry automatically. Turning off automatic creation stops new proposals; existing work can finish.</p>
        ${hasKey && settings.brief ? `<form method="post" action="/orchestrator/generate" class="form-actions"><input type="hidden" name="csrf" value="${esc(csrfToken)}"><button class="ghost">Create one research task now ${icon('arrow-right')}</button></form>` : ''}
      </aside>
    </div>
  </main>`, { configured: true });
}
