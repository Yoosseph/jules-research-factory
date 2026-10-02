const activeStatuses = ['queued', 'launching', 'running'];
const text = value => { const content = String(value ?? ''); return content.length > 20000 ? `${content.slice(0, 20000)}\n[Message truncated to 20,000 characters.]` : content; };

export function initializeFlow(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS agent_packets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, from_node TEXT NOT NULL,
    to_node TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
    content TEXT NOT NULL, created_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS agent_packets_project ON agent_packets(project_id,id);`);
}

export function recordPacket(store, { projectId = null, from = 'coordinator', to = 'jules', kind = 'message', title, content = '' }) {
  // Credentials never belong in the readable conversation stream.
  let safe = String(content ?? '');
  let safeTitle = String(title ?? '');
  for (const name of ['jules', 'github', 'orchestrator']) {
    const secret = store.getSecret(name);
    if (secret) { safe = safe.replaceAll(secret, '[redacted]'); safeTitle = safeTitle.replaceAll(secret, '[redacted]'); }
  }
  return Number(store.db.prepare('INSERT INTO agent_packets(project_id,from_node,to_node,kind,title,content,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(projectId, from, to, kind, text(safeTitle), text(safe), new Date().toISOString()).lastInsertRowid);
}

export function flowSnapshot(store, { modelBusy = false, projectId = null } = {}) {
  const settings = JSON.parse(store.get('orchestrator') ?? '{}');
  const projects = store.projects().sort((a, b) => Number(activeStatuses.includes(b.status)) - Number(activeStatuses.includes(a.status)) || b.updated_at.localeCompare(a.updated_at));
  const selected = projectId ? projects.filter(p => p.id === projectId) : projects;
  const hasPackets = !!store.db.prepare("SELECT name FROM sqlite_master WHERE name='agent_packets'").get();
  const packets = hasPackets ? store.db.prepare(`SELECT id,project_id AS projectId,from_node AS "from",to_node AS "to",kind,title,content,created_at AS createdAt FROM agent_packets ${projectId ? 'WHERE project_id=?' : ''} ORDER BY id DESC LIMIT 120`).all(...(projectId ? [projectId] : [])).map(p => ({ ...p, id: `packet:${p.id}`, observed: true })) : [];
  const activities = store.db.prepare(`SELECT name,project_id AS projectId,kind,originator,summary,detail,created_at AS createdAt FROM jules_activities ${projectId ? 'WHERE project_id=?' : ''} ORDER BY created_at DESC,name DESC LIMIT 120`).all(...(projectId ? [projectId] : []));
  for (const a of activities) {
    if (a.kind === 'progress' && a.summary === 'Progress update' && !a.detail) continue;
    packets.push({ id: `activity:${a.name}`, projectId: a.projectId, from: a.originator === 'user' ? 'coordinator' : 'jules', to: a.originator === 'user' ? 'jules' : a.kind === 'message' ? 'model' : 'coordinator', kind: a.kind, title: a.summary, content: a.detail, createdAt: a.createdAt, observed: false });
  }
  // Existing tasks retain their actual launch instructions, even before this view was added.
  for (const p of selected.slice(0, 60)) if (p.prompt_text && !packets.some(packet => packet.projectId === p.id && packet.kind === 'dispatch')) {
    packets.push({ id: `prompt:${p.id}`, projectId: p.id, from: p.orchestrator_instructions ? 'model' : 'coordinator', to: 'jules', kind: 'history', title: 'Saved task instructions', content: p.prompt_text, createdAt: p.created_at, observed: false });
  }
  packets.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const secrets = ['jules', 'github', 'orchestrator'].map(name => store.getSecret(name)).filter(Boolean);
  const redact = value => secrets.reduce((safe, secret) => safe.replaceAll(secret, '[redacted]'), String(value ?? ''));
  for (const packet of packets) { packet.content = redact(packet.content); packet.title = redact(packet.title); }
  const retryAt = store.get('orchestratorRetryAt') || null;
  const error = store.get('orchestratorLastError') || null;
  return {
    serverTime: new Date().toISOString(), model: settings.model || 'Not connected', provider: settings.provider || 'nvidia', enabled: !!settings.enabled,
    modelState: modelBusy ? 'Planning or replying' : retryAt && Date.parse(retryAt) > Date.now() ? 'Waiting to retry' : settings.enabled ? 'Ready' : 'Off',
    error: error ? redact(error) : null, retryAt, repository: store.binding()?.github_full_name || 'No repository',
    capacity: Number(store.get('concurrency') || 10), active: projects.filter(p => activeStatuses.includes(p.status)).length,
    projects: selected.slice(0, 100).map(p => ({ id: p.id, folder: redact(p.folder), topic: redact(p.topic), status: p.status, state: p.jules_state || p.status, updatedAt: p.jules_polled_at || p.updated_at, error: p.activity_error || p.error ? redact(p.activity_error || p.error) : null })),
    packets: packets.slice(0, 160), pollSeconds: 30
  };
}
