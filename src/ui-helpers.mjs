const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = value => String(value ?? '').replace(/[&<>"']/g, character => htmlEntities[character]);
export const attr = esc;
export const link = (href, label) => `<a href="${attr(href)}">${esc(label)}</a>`;
export const hiddenInput = (name, value) => `<input type="hidden" name="${attr(name)}" value="${attr(value)}">`;
export const csrf = token => hiddenInput('csrf', token);
export const notice = (message, kind = 'action', role = 'status') => message ? `<div class="notice ${attr(kind)}" role="${attr(role)}">${esc(message)}</div>` : '';

export const label = value => String(value ?? '').replaceAll('_', ' ').toLowerCase();
export const date = value => value ? new Date(value).toLocaleString('en-GB') : '—';
export const active = project => ['queued', 'launching', 'running'].includes(project.status);
export const statusClass = project => ['failed', 'blocked', 'pr_rejected'].includes(project.status) ? 'bad' : ['pr_validated', 'completed'].includes(project.status) ? 'good' : '';

export const nextNumber = (folders, projects = []) => Math.max(0, ...folders.map(item => item.number), ...projects.map(item => item.folder_number)) + 1;
