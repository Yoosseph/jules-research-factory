import { layout } from './layout.mjs';
import { icon, brandSymbol } from './icons.mjs';

export function welcomePage({ configured = false } = {}) {
  const start = configured ? '/orchestrator' : '/setup';
  const orbitMark = brandSymbol.replace('class="brand-symbol"', 'class="orbit-mark" x="250" y="190" width="40" height="40"');
  return layout('Research automation', `<main class="landing">
    <section class="landing-hero" aria-labelledby="hero-title">
      <div class="hero-copy reveal">
        <h1 id="hero-title">Automate research.<br><em>With NVIDIA + Jules.</em></h1>
        <p class="hero-description">Describe what to research. Your model creates task plans, and Jules produces reports with sources in your GitHub repository. Continuous mode fills available agent slots and handles routine questions automatically.</p>
        <div class="hero-actions"><a class="button primary" href="${start}">${configured ? 'Open orchestrator' : 'Connect Jules'} ${icon('arrow-up-right')}</a></div>
      </div>
      <div class="research-scene reveal" role="img" aria-label="Workflow: the model plans a task, Jules runs it, and a report is submitted to your repository">
        <div class="scene-top"><span class="scene-dot"></span> RESEARCH WORKFLOW <span class="scene-label">Workflow preview</span></div>
        <svg class="orbit-art" viewBox="0 0 520 440" fill="none" aria-hidden="true">
          <defs><radialGradient id="orbit-glow"><stop stop-color="#c98798" stop-opacity=".19"/><stop offset="1" stop-color="#c98798" stop-opacity="0"/></radialGradient><linearGradient id="orbit-line" x1="100" y1="80" x2="430" y2="370"><stop stop-color="#e6b8c3" stop-opacity=".8"/><stop offset="1" stop-color="#99707a" stop-opacity=".15"/></linearGradient></defs>
          <circle cx="270" cy="210" r="200" fill="url(#orbit-glow)"/>
          <g stroke="url(#orbit-line)"><ellipse cx="270" cy="210" rx="186" ry="94" transform="rotate(-38 270 210)"/><ellipse cx="270" cy="210" rx="186" ry="94" transform="rotate(38 270 210)"/><ellipse cx="270" cy="210" rx="94" ry="186"/><circle cx="270" cy="210" r="140" stroke-dasharray="2 7"/><circle cx="270" cy="210" r="71"/></g>
          <g stroke="#ddb0bb" stroke-opacity=".23"><path d="M63 210h415M270 23v374" stroke-dasharray="3 8"/><path d="M110 89l320 242M110 331L430 89" stroke-dasharray="3 8"/></g>
          <circle cx="133" cy="109" r="6" fill="#e7a2b3"/><circle cx="430" cy="281" r="5" fill="#d3b7be"/><circle cx="219" cy="378" r="4" fill="#e7a2b3"/>
          <circle cx="270" cy="210" r="47" fill="#78122d" stroke="#a98991" stroke-opacity=".5"/>
          ${orbitMark}
        </svg>
        <span class="orbit-tag tag-explore">${icon('search')} Plan</span><span class="orbit-tag tag-connect">${icon('workflow')} Run</span><span class="orbit-tag tag-synthesize">${icon('book-open')} Report</span>
        <div class="report-preview"><span class="report-icon">${icon('git-branch')}</span><div><strong>Reports submitted as pull requests</strong><small>Review findings and sources in your repository.</small></div></div>
      </div>
    </section>
    <section class="process-section reveal" id="how-it-works" aria-labelledby="process-title">
      <div class="process-intro"><h2 id="process-title">How to start</h2><p>Keep the app and computer running. New tasks use available Jules capacity and respect your account quota and optional daily cap.</p></div>
      <ol class="process-steps"><li><span class="process-number">01</span><div><h3>Connect Jules and GitHub</h3><p>Add your API keys and select the repository and branch for reports.</p></div></li><li><span class="process-number">02</span><div><h3>Set a research brief</h3><p>Connect an NVIDIA or OpenAI-compatible model. Describe the subjects and questions to investigate.</p></div></li><li><span class="process-number">03</span><div><h3>Enable continuous research</h3><p>Set agent capacity and turn on automatic creation. Finished tasks free slots for new research.</p></div></li></ol>
    </section>
  </main>`, { configured, landing: true });
}
