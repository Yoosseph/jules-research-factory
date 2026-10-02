(() => {
  const root = document.querySelector('[data-live-flow]');
  if (!root) return;
  const find = selector => root.querySelector(selector);
  const names = { model: 'NVIDIA', jules: 'Jules', coordinator: 'Research Facility', repository: 'Repository' };
  const stamp = date => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const node = (tag, className, text) => { const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element; };
  let snapshot, pending, paused = false, filterNode = '', project = '', selected = '', initialized = false;
  let queue = [], animating = false, selectionVersion = 0;
  const seen = new Set();
  const projectSelect = find('#flow-project');
  const connection = find('[data-flow-connection]');
  const pauseButton = find('[data-flow-pause]');
  const chat = find('[data-flow-chat]');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let agentSignature = '', chatSignature = '';

  function inspect(packet) {
    selected = packet.id;
    find('[data-packet-title]').textContent = packet.title;
    find('[data-packet-route]').textContent = `${names[packet.from]} to ${names[packet.to]} · ${stamp(packet.createdAt)}`;
    find('[data-packet-content]').textContent = packet.content || 'No additional text was returned for this event.';
    const link = find('[data-packet-project]');
    link.hidden = !packet.projectId;
    if (packet.projectId) link.href = `/projects/${encodeURIComponent(packet.projectId)}`;
    chat.querySelectorAll('[data-message-id]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.messageId === selected)));
  }

  function animateNext() {
    if (animating || paused || document.hidden || !queue.length) return;
    const packet = queue.shift();
    const path = find(`#wire-${packet.from}-${packet.to}`);
    find('[data-transfer-label]').textContent = `${names[packet.from]} to ${names[packet.to]}: ${packet.title}`;
    if (!path || motion.matches) { setTimeout(animateNext, 300); return; }
    animating = true;
    const svg = find('.flow-wires');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '5'); dot.setAttribute('class', `flow-packet ${packet.kind === 'error' ? 'packet-error' : ''}`);
    const travel = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
    travel.setAttribute('path', path.getAttribute('d')); travel.setAttribute('dur', '1.5s'); travel.setAttribute('fill', 'freeze');
    dot.append(travel); svg.append(dot);
    dot.addEventListener('click', () => inspect(packet));
    setTimeout(() => { dot.remove(); animating = false; animateNext(); }, 1600);
  }

  function render(data) {
    names.model = data.provider === 'nvidia' ? 'NVIDIA' : 'Model';
    find('[data-model-name]').textContent = names.model;
    find('[data-model-state]').textContent = data.modelState;
    find('[data-model-state]').title = data.model;
    const occupied = data.accountActive ?? data.active;
    find('[data-jules-state]').textContent = `${occupied} ${data.accountActive === null || data.accountActive === undefined ? 'local' : 'account-wide'} tasks`;
    find('[data-repository-name]').textContent = data.repository;
    find('[data-flow-capacity]').textContent = `${occupied} / ${data.capacity} slots occupied`;
    find('[data-capacity-checked]').textContent = data.capacityCheckedAt ? `Capacity checked ${stamp(data.capacityCheckedAt)}.` : 'Capacity check pending.';
    find('[data-agent-count]').textContent = data.projects.length;
    find('[data-model-state]').closest('button').classList.toggle('node-working', data.modelState === 'Planning or replying');
    find('[data-jules-state]').closest('button').classList.toggle('node-working', data.active > 0);
    const error = find('[data-flow-error]');
    error.hidden = !data.error;
    error.textContent = data.error ? `${data.error}${data.retryAt ? ` Retry: ${new Date(data.retryAt).toLocaleString()}.` : ''}` : '';
    error.className = `notice ${/denied|rejected|failed|invalid|did not return/i.test(data.error || '') ? 'error' : 'action'}`;

    const agentsKey = JSON.stringify(data.projects);
    if (agentsKey !== agentSignature) {
      agentSignature = agentsKey;
      const agents = find('[data-flow-agents]'); agents.replaceChildren();
      const options = [node('option', '', 'All agents')]; options[0].value = '';
      for (const agent of data.projects) {
        const option = node('option', '', agent.folder); option.value = agent.id; options.push(option);
        const button = node('button', 'flow-agent'); button.type = 'button'; button.dataset.agentId = agent.id;
        button.setAttribute('aria-pressed', String(agent.id === project));
        button.append(node('strong', '', agent.topic), node('span', 'flow-agent-state', agent.state.replaceAll('_', ' ').toLowerCase()), node('small', '', agent.error || agent.folder));
        button.addEventListener('click', () => chooseProject(agent.id)); agents.append(button);
      }
      if (!data.projects.length) agents.append(node('p', 'help', 'No tasks yet. Enable automatic research in Orchestrator.'));
      projectSelect.replaceChildren(...options); projectSelect.value = project;
    }
    root.querySelectorAll('[data-node]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.node === filterNode)));
    find('[data-flow-filter]').textContent = `${project ? data.projects.find(p => p.id === project)?.folder || 'Selected task' : 'All agents'}${filterNode ? ` · ${names[filterNode]}` : ''}`;
    const packets = data.packets.filter(p => (!project || p.projectId === project) && (!filterNode || p.from === filterNode || p.to === filterNode));
    const messagesKey = packets.map(p => p.id).join('|');
    if (messagesKey !== chatSignature) {
      chatSignature = messagesKey;
      const scrollTop = chat.scrollTop;
      chat.replaceChildren();
      for (const packet of packets) {
        const button = node('button', `flow-message ${packet.kind === 'error' ? 'message-error' : ''}`);
        button.type = 'button'; button.dataset.messageId = packet.id; button.setAttribute('aria-pressed', String(packet.id === selected));
        button.append(node('span', 'message-route', `${names[packet.from]} to ${names[packet.to]} · ${stamp(packet.createdAt)}`), node('strong', '', packet.title), node('span', 'message-preview', packet.content.slice(0, 180) || packet.kind));
        button.addEventListener('click', () => inspect(packet)); chat.append(button);
      }
      if (!packets.length) chat.append(node('p', 'help', 'No recorded messages for this selection yet.'));
      chat.scrollTop = scrollTop;
      if (!selected && packets.length) inspect(packets.find(packet => packet.content) || packets[0]);
    }
  }

  async function accept(data) {
    if (paused) { pending = data; return; }
    snapshot = data;
    for (const packet of [...data.packets].reverse()) {
      if (initialized && !seen.has(packet.id) && packet.kind !== 'history') queue.push(packet);
      seen.add(packet.id);
    }
    initialized = true;
    if (seen.size > 4000) { const keep = [...seen].slice(-2000); seen.clear(); keep.forEach(id => seen.add(id)); }
    queue = queue.slice(-24);
    render(data); animateNext();
    if (project) {
      const version = ++selectionVersion;
      const selectedProject = project;
      try {
        const response = await fetch(`/api/flow?project=${encodeURIComponent(selectedProject)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const detail = await response.json();
        if (version === selectionVersion && project === selectedProject && !paused) render({ ...snapshot, packets: detail.packets });
      } catch { /* Keep the last streamed conversation during reconnects. */ }
    }
  }

  function chooseProject(value) {
    project = value; selected = ''; agentSignature = ''; chatSignature = ''; selectionVersion++;
    if (snapshot) { if (paused) render(snapshot); else accept(snapshot); }
  }
  projectSelect.addEventListener('change', () => chooseProject(projectSelect.value));
  root.querySelectorAll('[data-node]').forEach(button => button.addEventListener('click', () => {
    filterNode = filterNode === button.dataset.node ? '' : button.dataset.node; chatSignature = ''; if (snapshot) { if (paused) render(snapshot); else accept(snapshot); }
  }));
  find('[data-clear-node]').addEventListener('click', () => { filterNode = ''; chatSignature = ''; if (snapshot) { if (paused) render(snapshot); else accept(snapshot); } });
  pauseButton.addEventListener('click', () => {
    paused = !paused; pauseButton.setAttribute('aria-pressed', String(paused)); pauseButton.textContent = paused ? 'Resume view' : 'Pause view';
    root.classList.toggle('flow-paused', paused);
    if (!paused) { if (pending) { const latest = pending; pending = null; accept(latest); } animateNext(); }
  });
  const stream = new EventSource('/api/flow/stream');
  stream.addEventListener('open', () => { connection.textContent = 'Live connection'; connection.classList.add('connected'); });
  stream.addEventListener('snapshot', event => { try { accept(JSON.parse(event.data)); } catch { connection.textContent = 'Unable to read update'; } });
  stream.addEventListener('error', () => { connection.textContent = 'Reconnecting'; connection.classList.remove('connected'); });
  document.addEventListener('visibilitychange', animateNext);
  addEventListener('pagehide', () => stream.close());
})();
