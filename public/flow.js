// Use a frame clock so transfers freeze while paused or hidden, and never rely on
// SVG animateMotion support. All items come from recorded messages.
class FlowTraffic {
  constructor({ start, frame, finish, changed = () => {}, requestFrame = callback => requestAnimationFrame(callback), cancelFrame = handle => cancelAnimationFrame(handle), duration = 4600 }) {
    Object.assign(this, { start, frame, finish, changed, requestFrame, cancelFrame, duration });
    this.queue = []; this.active = []; this.clock = 0; this.last = null;
    this.lastStart = -Infinity; this.paused = false; this.hidden = false; this.handle = null;
  }
  enqueue(packets, replay = false) {
    const items = packets.map(packet => ({ packet, replay }));
    this.queue = replay ? this.queue.concat(items) : this.queue.filter(item => !item.replay).concat(items, this.queue.filter(item => item.replay));
    this.schedule(); this.changed(this);
  }
  schedule() {
    if (this.handle !== null || this.paused || this.hidden || (!this.queue.length && !this.active.length)) return;
    this.handle = this.requestFrame(time => this.tick(time));
  }
  tick(time) {
    this.handle = null;
    if (this.paused || this.hidden) return;
    if (this.last !== null) this.clock += Math.max(0, time - this.last);
    this.last = time;
    const spacing = this.queue.length > 12 ? 180 : 650;
    if (this.queue.length && this.active.length < 10 && this.clock - this.lastStart >= spacing) {
      const item = this.queue.shift();
      const visual = this.start(item);
      if (visual) this.active.push({ ...item, visual, started: this.clock });
      this.lastStart = this.clock;
    }
    this.active = this.active.filter(item => {
      const progress = Math.min(1, (this.clock - item.started) / this.duration);
      this.frame(item, progress);
      if (progress < 1) return true;
      this.finish(item); return false;
    });
    this.changed(this); this.schedule();
    if (this.handle === null) this.last = null;
  }
  freeze(property, value) {
    this[property] = value; this.last = null;
    if ((this.paused || this.hidden) && this.handle !== null) { this.cancelFrame(this.handle); this.handle = null; }
    this.changed(this); this.schedule();
  }
  prune(predicate) {
    this.queue = this.queue.filter(item => predicate(item.packet));
    this.active = this.active.filter(item => { if (predicate(item.packet)) return true; this.finish(item); return false; });
    this.changed(this);
  }
  close() {
    if (this.handle !== null) this.cancelFrame(this.handle);
    this.handle = null; this.active.forEach(item => this.finish(item)); this.active = []; this.queue = [];
  }
}

(() => {
  const root = document.querySelector('[data-live-flow]');
  if (!root) return;
  const find = selector => root.querySelector(selector);
  const names = { model: 'NVIDIA', jules: 'Jules', coordinator: 'Research Facility', repository: 'Repository' };
  const stamp = date => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const node = (tag, className, text) => { const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element; };
  let snapshot, pending, paused = false, filterNode = '', project = '', selected = '', initialized = false;
  let selectionVersion = 0, received = 0;
  const seen = new Set();
  const projectSelect = find('#flow-project');
  const connection = find('[data-flow-connection]');
  const pauseButton = find('[data-flow-pause]');
  const chat = find('[data-flow-chat]');
  const peek = find('[data-packet-peek]'), dialog = find('[data-packet-dialog]');
  let inspectedPacket, returnFocus;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let animate = !motion.matches;
  let agentSignature = '', chatSignature = '', mapSignature = null, conversationPackets = [];
  const stage = find('.flow-stage');
  const svg = find('.flow-wires');
  const svgNode = tag => document.createElementNS('http://www.w3.org/2000/svg', tag);
  const overlay = svgNode('svg');
  overlay.setAttribute('viewBox', svg.getAttribute('viewBox')); overlay.setAttribute('preserveAspectRatio', 'none');
  overlay.setAttribute('role', 'group'); overlay.setAttribute('aria-label', 'Message packets'); overlay.setAttribute('class', 'flow-wires flow-traffic-layer'); stage.append(overlay);
  const replayButton = find('[data-flow-replay]');
  const motionButton = find('[data-flow-motion]');
  const eligible = packet => (!project || packet.projectId === project) && (!filterNode || packet.from === filterNode || packet.to === filterNode);
  const shortTitle = packet => ({ dispatch: 'Task plan', request: 'Model request', response: 'Response', reply: 'Message', approval: 'Approval', plan: 'Plan', progress: 'Research update', state: 'Status', history: 'Saved task', report: 'Report ready', error: 'Error', failed: 'Failed', completed: 'Complete' })[packet.kind] || 'Update';
  const failed = packet => ['error', 'failed'].includes(packet.kind);
  const kindLabel = packet => /review/i.test(packet.title) ? 'Review' : ({ message:'Message', dispatch:'Task plan', request:'Request', response:'Response', reply:'Response', approval:'Approval', plan:'Task plan', progress:'Research update', state:'Status', history:'Task instructions', report:'Completed report', error:'Error', failed:'Error', completed:'Completed task', command:'Command output', change:'Changes' })[packet.kind] || 'Update';

  function showTransfer({ packet, replay }) {
    find('[data-transfer-label]').textContent = `${replay ? 'Replay' : 'Live'} · ${names[packet.from]} to ${names[packet.to]}: ${packet.title}`;
    find('[data-flow-mode]')?.replaceChildren(document.createTextNode(replay ? 'Replaying recorded messages' : 'Live message traffic'));
  }

  const traffic = new FlowTraffic({
    start(item) {
      showTransfer(item);
      const path = find(`#wire-${item.packet.from}-${item.packet.to}`);
      if (!path) return null;
      const group = svgNode('g'); group.setAttribute('class', `flow-moving-packet packet-from-${item.packet.from}${failed(item.packet) ? ' packet-error' : ''}${item.packet.kind === 'report' ? ' packet-report' : ''}`);
      group.setAttribute('data-moving-id', item.packet.id);
      group.setAttribute('role', 'button'); group.setAttribute('tabindex', '0'); group.setAttribute('aria-controls', 'packet-peek');
      group.setAttribute('aria-label', `Open ${kindLabel(item.packet).toLowerCase()}: ${item.packet.title}, ${names[item.packet.from]} to ${names[item.packet.to]}`);
      const hit = svgNode('ellipse'); hit.setAttribute('class', 'flow-packet-hit'); hit.setAttribute('fill', 'transparent'); group.append(hit);
      const dots = [6, 4, 3, 2].map((radius, index) => {
        const dot = svgNode('circle'); dot.setAttribute('r', String(radius)); dot.setAttribute('class', index ? 'flow-packet-tail' : 'flow-packet'); dot.setAttribute('opacity', String(1 - index * .23)); group.append(dot); return dot;
      });
      const label = svgNode('text'); label.setAttribute('class', 'flow-packet-caption'); label.textContent = `${item.replay ? 'Replay · ' : ''}${shortTitle(item.packet)}`; group.append(label);
      group.addEventListener('click', () => inspect(item.packet, { trigger: group }));
      group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect(item.packet, { trigger: group }); } });
      overlay.append(group);
      const length = path.getTotalLength(), bounds = overlay.getBoundingClientRect();
      const view = svg.viewBox.baseVal;
      hit.setAttribute('rx', String(Math.max(18, 22 * view.width / bounds.width))); hit.setAttribute('ry', String(Math.max(18, 22 * view.height / bounds.height)));
      const inside = (distance, actor) => {
        const button = find(`[data-node="${actor}"]`); if (!button) return false;
        const box = button.getBoundingClientRect(), point = path.getPointAtLength(distance);
        const x = bounds.left + point.x * bounds.width / view.width, y = bounds.top + point.y * bounds.height / view.height;
        return x >= box.left - 7 && x <= box.right + 7 && y >= box.top - 7 && y <= box.bottom + 7;
      };
      let begin = 0, end = length;
      while (begin < length / 2 && inside(begin, item.packet.from)) begin += 4;
      while (end > begin && inside(end, item.packet.to)) end -= 4;
      return { group, dots, hit, label, path, begin, distance: Math.max(0, end - begin) };
    },
    frame(item, progress) {
      const { dots, hit, label, path, begin, distance } = item.visual;
      dots.forEach((dot, index) => {
        const point = path.getPointAtLength(begin + distance * (animate ? Math.max(0, progress - index * .045) : .5));
        dot.setAttribute('cx', point.x); dot.setAttribute('cy', point.y);
        if (!index) { hit.setAttribute('cx', point.x); hit.setAttribute('cy', point.y); label.setAttribute('x', point.x); label.setAttribute('y', point.y - 16); }
      });
      item.visual.group.setAttribute('data-progress', String(progress));
    },
    finish(item) { item.visual.group.remove(); },
    changed(state) {
      // Keep one caption per route so bursts remain readable while every dot travels.
      const captions = new Map();
      for (const item of state.active) {
        const route = `${item.packet.from}-${item.packet.to}`;
        const current = captions.get(route);
        if (!current || Math.abs(state.clock - item.started - state.duration / 2) < Math.abs(state.clock - current.started - state.duration / 2)) captions.set(route, item);
      }
      for (const item of state.active) item.visual.label.setAttribute('visibility', captions.get(`${item.packet.from}-${item.packet.to}`) === item ? 'visible' : 'hidden');
      const counter = find('[data-flow-transfers]');
      if (counter) counter.textContent = `${state.active.length} on map · ${state.queue.length} waiting · ${received} new`;
      root.querySelectorAll('[data-node]').forEach(button => button.classList.toggle('node-transmitting', state.active.some(item => item.packet.from === button.dataset.node || item.packet.to === button.dataset.node)));
      const mode = find('[data-flow-mode]');
      if (mode) mode.textContent = state.paused ? 'View paused' : state.active.some(item => !item.replay) ? 'Live message traffic' : state.active.length || state.queue.some(item => item.replay) ? 'Replaying recorded messages' : state.queue.length ? 'Live message traffic' : 'Waiting for new messages';
    }
  });
  traffic.freeze('hidden', document.hidden);

  function inspect(packet, { open = true, trigger = document.activeElement } = {}) {
    inspectedPacket = packet;
    selected = packet.id;
    for (const title of root.querySelectorAll('[data-packet-title]')) title.textContent = packet.title;
    for (const kind of root.querySelectorAll('[data-packet-kind]')) kind.textContent = kindLabel(packet);
    for (const route of root.querySelectorAll('[data-packet-route]')) route.textContent = `${names[packet.from]} to ${names[packet.to]} · ${stamp(packet.createdAt)}`;
    for (const content of root.querySelectorAll('[data-packet-content]')) { content.textContent = packet.content || 'No additional text was returned for this event.'; content.scrollTop = 0; }
    for (const link of root.querySelectorAll('[data-packet-project]')) {
      link.hidden = !packet.projectId;
      if (packet.projectId) link.href = `/projects/${encodeURIComponent(packet.projectId)}`;
      else link.removeAttribute('href');
    }
    let product = '';
    try { const url = new URL(packet.productUrl); if (url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(url.pathname)) product = url.href; } catch { /* Only validated report destinations are links. */ }
    for (const link of root.querySelectorAll('[data-packet-product]')) { link.hidden = !product; if (product) link.href = product; else link.removeAttribute('href'); }
    root.querySelectorAll('[data-packet-expand]').forEach(button => { button.disabled = false; });
    root.querySelectorAll('[data-message-id],[data-map-message-id]').forEach(button => button.setAttribute('aria-pressed', String((button.dataset.messageId || button.dataset.mapMessageId) === selected)));
    if (open && peek) { returnFocus = trigger; peek.hidden = false; if (!dialog?.open) find('[data-packet-peek-close]').focus({ preventScroll: true }); }
  }

  const restoreFocus = () => (returnFocus?.isConnected ? returnFocus : replayButton)?.focus({ preventScroll: true });
  find('[data-packet-peek-close]')?.addEventListener('click', () => { peek.hidden = true; restoreFocus(); });
  root.querySelectorAll('[data-packet-expand]').forEach(button => button.addEventListener('click', () => {
    if (!dialog || !inspectedPacket) return;
    if (peek.hidden) returnFocus = button;
    peek.hidden = true; dialog.showModal();
  }));
  find('[data-packet-dialog-close]')?.addEventListener('click', () => dialog.close());
  find('[data-packet-collapse]')?.addEventListener('click', () => { dialog.close('compact'); });
  dialog?.addEventListener('close', () => {
    if (dialog.returnValue === 'compact') { dialog.returnValue = ''; peek.hidden = false; find('[data-packet-expand]').focus({ preventScroll: true }); }
    else restoreFocus();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && peek && !peek.hidden && !dialog?.open) { peek.hidden = true; restoreFocus(); } });

  function render(data) {
    conversationPackets = data.packets;
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
    for (const button of root.querySelectorAll('[data-node]')) {
      const latest = packets.find(packet => packet.from === button.dataset.node || packet.to === button.dataset.node);
      const last = button.querySelector('[data-node-last]');
      if (last) { last.textContent = latest ? latest.title : 'Waiting for messages'; last.title = latest?.content || ''; }
    }
    const mapMessages = find('[data-map-messages]');
    const mapKey = packets.slice(0, 6).map(packet => packet.id).join('|');
    if (mapMessages && mapSignature !== mapKey) {
      mapSignature = mapKey;
      mapMessages.replaceChildren();
      for (const packet of packets.slice(0, 6)) {
        const button = node('button', `flow-map-message${failed(packet) ? ' map-message-error' : ''}`); button.type = 'button'; button.dataset.mapMessageId = packet.id;
        button.append(node('span', '', `${names[packet.from]} → ${names[packet.to]} · ${stamp(packet.createdAt)}`), node('strong', '', packet.title));
        button.title = packet.content; button.addEventListener('click', () => { inspect(packet); traffic.enqueue([packet], true); }); mapMessages.append(button);
      }
      if (!packets.length) mapMessages.append(node('p', 'help', 'Messages will appear here when research starts.'));
    }
    const messagesKey = packets.map(p => p.id).join('|');
    if (messagesKey !== chatSignature) {
      chatSignature = messagesKey;
      const scrollTop = chat.scrollTop;
      chat.replaceChildren();
      for (const packet of packets) {
        const button = node('button', `flow-message ${packet.kind === 'error' ? 'message-error' : ''}`);
        button.type = 'button'; button.dataset.messageId = packet.id; button.setAttribute('aria-pressed', String(packet.id === selected));
        button.append(node('span', 'message-route', `${names[packet.from]} to ${names[packet.to]} · ${stamp(packet.createdAt)}`), node('strong', '', packet.title), node('span', 'message-preview', packet.content.slice(0, 180) || packet.kind));
        button.addEventListener('click', () => { inspect(packet); traffic.enqueue([packet], true); }); chat.append(button);
      }
      if (!packets.length) chat.append(node('p', 'help', 'No recorded messages for this selection yet.'));
      chat.scrollTop = scrollTop;
      if (!selected && packets.length && (!peek || peek.hidden) && !dialog?.open) inspect(packets.find(packet => packet.content) || packets[0], { open: false });
    }
  }

  async function accept(data) {
    if (paused) { pending = data; return; }
    snapshot = data;
    const incoming = [];
    for (const packet of [...data.packets].reverse()) {
      if (initialized && !seen.has(packet.id) && packet.kind !== 'history') { received++; if (eligible(packet)) incoming.push(packet); }
      seen.add(packet.id);
    }
    const firstSnapshot = !initialized;
    initialized = true;
    if (seen.size > 4000) { const keep = [...seen].slice(-2000); seen.clear(); keep.forEach(id => seen.add(id)); }
    render(data);
    if (firstSnapshot) traffic.enqueue(data.packets.filter(eligible).slice(0, 8).reverse(), true);
    if (incoming.length) traffic.enqueue(incoming);
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
    traffic.prune(eligible);
    if (snapshot) { if (paused) render(snapshot); else accept(snapshot); }
  }
  projectSelect.addEventListener('change', () => chooseProject(projectSelect.value));
  root.querySelectorAll('[data-node]').forEach(button => button.addEventListener('click', () => {
    filterNode = filterNode === button.dataset.node ? '' : button.dataset.node; chatSignature = ''; traffic.prune(eligible); if (snapshot) { if (paused) render(snapshot); else accept(snapshot); }
  }));
  find('[data-clear-node]').addEventListener('click', () => { filterNode = ''; chatSignature = ''; if (snapshot) { if (paused) render(snapshot); else accept(snapshot); } });
  pauseButton.addEventListener('click', () => {
    paused = !paused; pauseButton.setAttribute('aria-pressed', String(paused)); pauseButton.textContent = paused ? 'Resume view' : 'Pause view';
    root.classList.toggle('flow-paused', paused);
    traffic.freeze('paused', paused);
    if (!paused && pending) { const latest = pending; pending = null; accept(latest); }
  });
  replayButton?.addEventListener('click', () => {
    traffic.queue = traffic.queue.filter(item => !item.replay);
    traffic.enqueue(conversationPackets.filter(eligible).slice(0, 12).reverse(), true);
  });
  function updateMotion() { if (motionButton) { motionButton.textContent = animate ? 'Motion on' : 'Motion off'; motionButton.setAttribute('aria-pressed', String(animate)); } }
  updateMotion();
  motionButton?.addEventListener('click', () => { animate = !animate; updateMotion(); });
  const stream = new EventSource('/api/flow/stream');
  stream.addEventListener('open', () => { connection.textContent = 'Live connection'; connection.classList.add('connected'); });
  stream.addEventListener('snapshot', event => { try { accept(JSON.parse(event.data)).catch(() => { connection.textContent = 'Unable to display update'; }); } catch { connection.textContent = 'Unable to read update'; } });
  stream.addEventListener('error', () => { connection.textContent = 'Reconnecting'; connection.classList.remove('connected'); });
  document.addEventListener('visibilitychange', () => traffic.freeze('hidden', document.hidden));
  addEventListener('pagehide', () => { stream.close(); traffic.close(); });
})();
