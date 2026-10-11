const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = value => String(value ?? '').replace(/[&<>"']/g, character => htmlEntities[character]);
export const attr = esc;
export const link = (href, label) => `<a href="${attr(href)}">${esc(label)}</a>`;
export const hiddenInput = (name, value) => `<input type="hidden" name="${attr(name)}" value="${attr(value)}">`;
export const csrf = token => hiddenInput('csrf', token);
export const notice = (message, kind = 'action', role = 'status') => message ? `<div class="notice ${attr(kind)}" role="${attr(role)}">${esc(message)}</div>` : '';

export const label = value => String(value ?? '').replaceAll('_', ' ').toLowerCase();
export const date = value => value ? new Date(value).toLocaleString('en-GB') : '—';
export const active = project => ['queued', 'launching', 'running', 'stopping'].includes(project.status);
export const statusClass = project => ['failed', 'blocked', 'pr_rejected'].includes(project.status) ? 'bad' : ['pr_validated', 'completed'].includes(project.status) ? 'good' : '';

export const nextNumber = (folders, projects = []) => Math.max(0, ...folders.map(item => item.number), ...projects.map(item => item.folder_number)) + 1;

export function pageNavigation(pagination, path) {
  if (!pagination || pagination.pages <= 1) return '';
  const { page, pages, total } = pagination;
  return `<nav class="form-actions" aria-label="History pages">${page > 1 ? `<a class="button ghost" href="${attr(path)}?page=${page - 1}">Newer</a>` : ''}<span>Page ${page} of ${pages} · ${total} records</span>${page < pages ? `<a class="button ghost" href="${attr(path)}?page=${page + 1}">Older</a>` : ''}</nav>`;
}
