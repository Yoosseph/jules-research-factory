import { readFileSync } from 'node:fs';

const names = ['arrow-right', 'arrow-left', 'arrow-up-right', 'sparkles', 'workflow', 'shield-check', 'activity', 'folder-open', 'settings-2', 'search', 'check', 'book-open', 'git-branch', 'circle-dot'];
const icons = new Map(names.map(name => [name, readFileSync(new URL(`../public/icons/${name}.svg`, import.meta.url), 'utf8')
  .replace('<svg', '<svg class="icon" aria-hidden="true" focusable="false"')]));

export function icon(name) {
  if (!icons.has(name)) throw new Error(`Unknown icon: ${name}`);
  return icons.get(name);
}

export const brandSymbol = '<svg class="brand-symbol" viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="13"/><ellipse cx="20" cy="20" rx="7" ry="18" transform="rotate(45 20 20)"/><ellipse cx="20" cy="20" rx="7" ry="18" transform="rotate(-45 20 20)"/><circle cx="20" cy="20" r="3" fill="currentColor" stroke="none"/></svg>';
