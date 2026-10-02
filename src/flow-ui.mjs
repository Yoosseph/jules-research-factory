import { layout } from './ui.mjs';
import { icon } from './icons.mjs';

export function flowPage() {
  return layout('Live flow', `<main class="flow-page" data-live-flow>
    <div class="page-heading"><div><span class="eyebrow">Agent communication</span><h1>Live flow</h1><p class="lead">Follow task plans, research updates, and replies between agents.</p></div><div class="flow-controls"><span class="flow-connection" role="status" data-flow-connection>Connecting</span><button class="ghost" type="button" data-flow-pause aria-pressed="false">Pause view</button></div></div>
    <section class="flow-stage" aria-label="Interactive agent communication map">
      <div class="flow-stage-heading"><span class="eyebrow">Research network</span><span data-flow-capacity>Loading agent capacity</span></div>
      <svg class="flow-wires" viewBox="0 0 1000 380" preserveAspectRatio="none" aria-hidden="true">
        <path id="wire-model-jules" d="M180 135 C340 40 420 40 500 135"/><path id="wire-jules-model" d="M500 135 C420 220 340 220 180 135"/>
        <path id="wire-jules-repository" d="M500 135 C660 135 660 135 820 135"/>
        <path id="wire-coordinator-model" d="M500 310 C340 310 180 270 180 135"/><path id="wire-model-coordinator" d="M180 135 C180 270 340 310 500 310"/>
        <path id="wire-coordinator-jules" d="M500 310 L500 135"/><path id="wire-jules-coordinator" d="M500 135 L500 310"/>
        <path id="wire-coordinator-repository" d="M500 310 C720 310 820 270 820 135"/>
      </svg>
      <button class="flow-node node-model" data-node="model" type="button" aria-pressed="false">${icon('sparkles')}<span class="flow-node-name" data-model-name>NVIDIA</span><small data-model-state>Loading</small></button>
      <button class="flow-node node-jules" data-node="jules" type="button" aria-pressed="false">${icon('workflow')}<span class="flow-node-name">Jules agents</span><small data-jules-state>Loading</small></button>
      <button class="flow-node node-repository" data-node="repository" type="button" aria-pressed="false">${icon('git-branch')}<span class="flow-node-name">Repository</span><small data-repository-name>Loading</small></button>
      <button class="flow-node node-coordinator" data-node="coordinator" type="button" aria-pressed="false">${icon('circle-dot')}<span class="flow-node-name">Research Facility</span><small>Routes plans and replies</small></button>
      <div class="flow-transfer" data-transfer-label role="status">Waiting for recorded activity</div>
    </section>
    <p class="flow-source-note">Packets show recorded messages and API handoffs. Jules updates are checked every 30 seconds. <span data-capacity-checked></span> Select a node, agent, or message to inspect it.</p>
    <div class="notice" data-flow-error hidden role="status"></div>
    <div class="flow-workspace">
      <section class="panel flow-agents"><div class="panel-heading"><h2>Agents</h2><span data-agent-count></span></div><label for="flow-project">Conversation</label><select id="flow-project"><option value="">All agents</option></select><div data-flow-agents></div></section>
      <section class="panel flow-conversation"><div class="panel-heading"><h2>Conversation</h2><button class="text-link" type="button" data-clear-node>All nodes</button></div><p class="help" data-flow-filter>All recorded messages</p><div class="flow-chat" data-flow-chat><p class="help">Loading messages...</p></div></section>
      <section class="panel flow-inspector"><span class="eyebrow">Selected packet</span><h2 data-packet-title>Select a message</h2><p class="help" data-packet-route>Read its full content here.</p><pre data-packet-content>No message selected.</pre><a class="text-link" data-packet-project hidden>Open task timeline ${icon('arrow-up-right')}</a></section>
    </div><noscript><p class="notice">Enable JavaScript for the live view. <a href="/activity">Read the agent timelines</a> without it.</p></noscript><script src="/flow.js" defer></script>
  </main>`, { configured: true });
}
