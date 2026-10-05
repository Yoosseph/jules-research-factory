import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { icon, brandSymbol } from './icons.mjs';
import { esc } from './ui-helpers.mjs';

const stylesheet = readFileSync(join(import.meta.dirname, '..', 'public', 'style.css'), 'utf8');
export const styleHash = createHash('sha256').update(stylesheet).digest('base64');

function decorateContent(body) {
  // Give existing directional links the same Lucide treatment as the new screens.
  return body.replace(/<div class="notice([^"]*)"([^>]*)>([\s\S]*?)<\/div>/g, (match, classes, attrs, content) => `<div class="notice ${classes.includes('success') ? 'success' : /denied|rejected|forbidden|failed|invalid|mismatch|did not return/i.test(content.replace(/<[^>]*>/g, '')) ? 'error' : 'action'}"${attrs}>${content}</div>`).replace(/(<a\b[^>]*>)([^<]*)(<\/a>)/g, (match, start, label, end) => {
    if (label.startsWith('← ')) return `${start}${icon('arrow-left')} ${label.slice(2)}${end}`;
    if (/[↗→]$/.test(label)) return `${start}${label.slice(0, -1).trimEnd()} ${icon(label.endsWith('↗') ? 'arrow-up-right' : 'arrow-right')}${end}`;
    return match;
  });
}
export function layout(title, body, { configured = false, autoRefresh = false, landing = false } = {}) {
  const activeTitle = { '/welcome': 'Research automation', '/flow': 'Live flow', '/': 'Projects', '/activity': 'Jules agents', '/orchestrator': 'Research orchestrator', '/prompt': 'Research prompt', '/settings': 'Connection' };
  const navLink = (href, label) => `<a href="${href}"${title === activeTitle[href] ? ' aria-current="page"' : ''}>${label}</a>`;
  const navigation = configured ? `${navLink('/flow', 'Live flow')}${navLink('/', 'Projects')}${navLink('/activity', 'Agents')}${navLink('/orchestrator', 'Orchestrator')}${navLink('/prompt', 'Prompt')}${navLink('/settings', 'Connection')}` : `<a href="/welcome">Overview</a><a aria-current="page" href="/setup">Connect workspace</a>`;
  const content = decorateContent(body);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#f5f4ed"><meta name="description" content="Automate research with NVIDIA and Jules. Create task plans and submit reports with sources to your GitHub repository.">${autoRefresh ? '<meta http-equiv="refresh" content="20">' : ''}<title>${esc(title)} · Research Facility</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="preload" href="/fonts/manrope.ttf" as="font" type="font/ttf" crossorigin><link rel="preload" href="/fonts/fraunces.ttf" as="font" type="font/ttf" crossorigin><script src="/theme.js"></script><style>${stylesheet}</style><script src="/interface.js" defer></script></head><body class="${landing ? 'landing-page' : 'workspace-page'}"><a class="skip-link" href="#main-content">Skip to content</a><div class="shell"><header class="topbar"><div class="brand"><button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch color theme" aria-pressed="false">${brandSymbol}</button><a class="brand-link" href="/welcome">Research Facility</a></div>${landing ? '' : `<nav aria-label="Primary navigation">${navigation}</nav>`}</header>${content.replace('<main', '<main id="main-content"')}</div></body></html>`;
}
