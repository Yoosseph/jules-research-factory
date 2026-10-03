import { layout } from './ui.mjs';
import { icon } from './icons.mjs';

const packetReader = expanded => `<div class="packet-reader-heading"><span class="eyebrow" data-packet-kind>Message</span><button class="packet-reader-close" type="button" ${expanded ? 'data-packet-dialog-close' : 'data-packet-peek-close'} aria-label="Close message">Close</button></div><h2 id="${expanded ? 'packet-expanded-title' : 'packet-peek-title'}" data-packet-title>Select a message</h2><p class="help" data-packet-route></p><pre class="packet-reader-content" data-packet-content></pre><div class="packet-reader-actions"><button class="ghost" type="button" ${expanded ? 'data-packet-collapse' : 'data-packet-expand'}>${expanded ? 'Compact view' : 'Expand message'} ${icon(expanded ? 'arrow-left' : 'arrow-up-right')}</button><a class="text-link" data-packet-product hidden target="_blank" rel="noopener noreferrer">Open completed report ${icon('arrow-up-right')}</a><a class="text-link" data-packet-project hidden>Task timeline ${icon('arrow-up-right')}</a></div>`;

export function flowPage() {
  return layout('Live flow', `<main class="flow-page" data-live-flow>
    <div class="page-heading"><div><span class="eyebrow">Agent communication</span><h1>Live flow</h1><p class="lead">Watch messages travel between agents. Select a dot or message to read it.</p></div><div class="flow-controls"><span class="flow-connection" role="status" data-flow-connection>Connecting</span><button class="ghost" type="button" data-flow-replay>Replay recent</button><button class="ghost" type="button" data-flow-motion aria-pressed="true">Motion on</button><button class="ghost" type="button" data-flow-pause aria-pressed="false">Pause view</button></div></div>
    <section class="flow-stage" aria-label="Interactive agent communication map">
      <div class="flow-stage-heading"><span class="eyebrow">Research network</span><span data-flow-capacity>Loading agent capacity</span></div>
      <div class="flow-traffic-status"><span data-flow-mode role="status">Connecting to message traffic</span><span data-flow-transfers>0 on map</span></div>
      <svg class="flow-wires" viewBox="0 0 1000 380" preserveAspectRatio="none" aria-hidden="true">
        <path id="wire-model-jules" d="M180 135 C340 40 420 40 500 135"/><path id="wire-jules-model" d="M500 135 C420 220 340 220 180 135"/>
        <path id="wire-jules-repository" d="M500 135 C660 135 660 135 820 135"/>
        <path id="wire-coordinator-model" d="M500 310 C340 310 180 270 180 135"/><path id="wire-model-coordinator" d="M180 135 C180 270 340 310 500 310"/>
        <path id="wire-coordinator-jules" d="M500 310 C350 310 350 220 500 135"/><path id="wire-jules-coordinator" d="M500 135 C650 220 650 310 500 310"/>
        <path id="wire-coordinator-repository" d="M500 310 C720 310 820 270 820 135"/>
      </svg>
      <button class="flow-node node-model" data-node="model" type="button" aria-pressed="false">${icon('sparkles')}<span class="flow-node-name" data-model-name>NVIDIA</span><small data-model-state>Loading</small><span class="flow-node-last" data-node-last>Waiting for messages</span></button>
      <button class="flow-node node-jules" data-node="jules" type="button" aria-pressed="false">${icon('workflow')}<span class="flow-node-name">Jules agents</span><small data-jules-state>Loading</small><span class="flow-node-last" data-node-last>Waiting for messages</span></button>
      <button class="flow-node node-repository" data-node="repository" type="button" aria-pressed="false">${icon('git-branch')}<span class="flow-node-name">Repository</span><small data-repository-name>Loading</small><span class="flow-node-last" data-node-last>Waiting for messages</span></button>
      <button class="flow-node node-coordinator" data-node="coordinator" type="button" aria-pressed="false">${icon('circle-dot')}<span class="flow-node-name">Research Facility</span><small>Routes plans and replies</small><span class="flow-node-last" data-node-last>Waiting for messages</span></button>
      <div class="flow-transfer" data-transfer-label role="status">Waiting for recorded activity</div>
      <div class="flow-map-messages" data-map-messages aria-label="Recent messages on the network"></div>
    </section>
    <aside class="packet-peek" id="packet-peek" data-packet-peek hidden role="region" aria-labelledby="packet-peek-title">${packetReader(false)}</aside>
    <dialog class="packet-dialog" data-packet-dialog aria-labelledby="packet-expanded-title">${packetReader(true)}</dialog>
    <p class="flow-source-note">Dots carry recorded messages and API handoffs. Recent messages replay once when you open the view; new arrivals are labeled Live. Jules updates are checked every 30 seconds. <span data-capacity-checked></span></p>
    <div class="notice" data-flow-error hidden role="status"></div>
    <div class="flow-workspace">
      <section class="panel flow-agents"><div class="panel-heading"><h2>Agents</h2><span data-agent-count></span></div><label for="flow-project">Conversation</label><select id="flow-project"><option value="">All agents</option></select><div data-flow-agents></div></section>
      <section class="panel flow-conversation"><div class="panel-heading"><h2>Conversation</h2><button class="text-link" type="button" data-clear-node>All nodes</button></div><p class="help" data-flow-filter>All recorded messages</p><div class="flow-chat" data-flow-chat><p class="help">Loading messages...</p></div></section>
      <section class="panel flow-inspector"><span class="eyebrow">Selected packet</span><h2 data-packet-title>Select a message</h2><p class="help" data-packet-route>Read its full content here.</p><pre data-packet-content>No message selected.</pre><div class="packet-reader-actions"><button class="ghost" type="button" data-packet-expand disabled>Expand message ${icon('arrow-up-right')}</button><a class="text-link" data-packet-product hidden target="_blank" rel="noopener noreferrer">Open completed report ${icon('arrow-up-right')}</a><a class="text-link" data-packet-project hidden>Open task timeline ${icon('arrow-up-right')}</a></div></section>
    </div><noscript><p class="notice">Enable JavaScript for the live view. <a href="/activity">Read the agent timelines</a> without it.</p></noscript><script src="/flow.js" defer></script>
  </main>`, { configured: true });
}
