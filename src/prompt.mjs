import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const defaultPromptPath = join(import.meta.dirname, '..', 'prompt-template.txt');
const experimentalPromptPath = join(import.meta.dirname, '..', 'prompts', 'experimental-research.txt');
const webPromptPath = join(import.meta.dirname, '..', 'prompts', 'web-research.txt');
const webPromptVersion = '2';
const placeholders = new Set(['topic', 'repository', 'branch', 'folder', 'runtime', 'development_seeds', 'final_seeds']);
const required = ['topic', 'repository', 'branch', 'folder'];

export function validatePromptTemplate(value) {
  const template = String(value ?? '').trim();
  if (template.length < 100 || template.length > 24000) throw new Error('The prompt template must be 100–24,000 characters.');
  for (const name of required) if (!template.includes(`{{${name}}}`)) throw new Error(`Keep the {{${name}}} placeholder in the prompt.`);
  for (const match of template.matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
    if (!placeholders.has(match[1])) throw new Error(`Unknown prompt placeholder: {{${match[1]}}}.`);
  }
  return template;
}

export function readPromptTemplate(path = defaultPromptPath) {
  return validatePromptTemplate(readFileSync(path, 'utf8'));
}

export function savePromptTemplate(value, path = defaultPromptPath) {
  const template = validatePromptTemplate(value);
  writeFileSync(path, `${template}\n`, { encoding: 'utf8' });
  return template;
}

export function initializePromptLibrary(store, path = defaultPromptPath) {
  const activeId = store.get('active_prompt_id');
  if (activeId) {
    const active = store.db.prepare('SELECT template FROM prompt_presets WHERE id=?').get(activeId);
    if (active) {
      if (store.get('web_prompt_version') !== webPromptVersion) {
        const web = readPromptTemplate(webPromptPath);
        const previous = store.db.prepare('SELECT template FROM prompt_presets WHERE id=?').get('web-research')?.template;
        const current = readPromptTemplate(path);
        const now = new Date().toISOString();
        const archive = store.db.prepare('INSERT OR IGNORE INTO prompt_presets(id,name,template,created_at,updated_at) VALUES (?,?,?,?,?)');
        archive.run('web-research', 'Web research', web, now, now);
        if (previous && previous !== web) archive.run('web-research-previous', 'Web research (previous)', previous, now, now);
        if (activeId === 'web-research' && current !== previous && current !== web) archive.run('web-research-local', 'Web research (local edits)', current, now, now);
        if (activeId !== 'web-research') syncActivePrompt(store, path);
        store.db.prepare('UPDATE prompt_presets SET template=?,updated_at=? WHERE id=?').run(web, now, 'web-research');
        if (activeId === 'web-research') savePromptTemplate(web, path);
        store.set('web_prompt_version', webPromptVersion);
      } else syncActivePrompt(store, path);
      return;
    }
  }
  const current = readPromptTemplate(path);
  const experimental = readPromptTemplate(experimentalPromptPath);
  const web = readPromptTemplate(webPromptPath);
  const now = new Date().toISOString();
  const insert = store.db.prepare('INSERT OR IGNORE INTO prompt_presets(id,name,template,created_at,updated_at) VALUES (?,?,?,?,?)');
  insert.run('experimental-research', 'Experimental research', experimental, now, now);
  insert.run('web-research', 'Web research', web, now, now);
  if (current !== experimental && current !== web) insert.run('previous-prompt', 'Previous prompt', current, now, now);
  savePromptTemplate(web, path);
  store.set('active_prompt_id', 'web-research');
  store.set('web_prompt_version', webPromptVersion);
}

export function syncActivePrompt(store, path = defaultPromptPath) {
  const id = store.get('active_prompt_id');
  const active = store.db.prepare('SELECT template FROM prompt_presets WHERE id=?').get(id);
  if (!active) throw new Error('The active prompt could not be found.');
  const fileTemplate = readPromptTemplate(path);
  if (fileTemplate !== active.template) store.db.prepare('UPDATE prompt_presets SET template=?,updated_at=? WHERE id=?').run(fileTemplate, new Date().toISOString(), id);
  return fileTemplate;
}

export function promptLibrary(store) {
  const presets = store.db.prepare('SELECT id,name,template FROM prompt_presets ORDER BY created_at,id').all();
  const activeId = store.get('active_prompt_id');
  return { presets, activeId };
}

export function saveActivePrompt(store, value, path = defaultPromptPath) {
  const id = store.get('active_prompt_id');
  if (!store.db.prepare('SELECT id FROM prompt_presets WHERE id=?').get(id)) throw new Error('The active prompt could not be found.');
  const template = savePromptTemplate(value, path);
  store.db.prepare('UPDATE prompt_presets SET template=?,updated_at=? WHERE id=?').run(template, new Date().toISOString(), id);
  return template;
}

export function activatePrompt(store, id, path = defaultPromptPath) {
  const preset = store.db.prepare('SELECT id,name,template FROM prompt_presets WHERE id=?').get(id);
  if (!preset) throw new Error('Choose a saved prompt.');
  syncActivePrompt(store, path);
  savePromptTemplate(preset.template, path);
  store.set('active_prompt_id', id);
  return preset;
}

export function savePromptAsNew(store, name, value, path = defaultPromptPath) {
  const title = String(name ?? '').trim();
  if (!title || title.length > 80) throw new Error('Enter a prompt name of 1–80 characters.');
  if (store.db.prepare('SELECT id FROM prompt_presets WHERE lower(name)=lower(?)').get(title)) throw new Error('A saved prompt already has that name.');
  const template = validatePromptTemplate(value);
  const id = randomUUID();
  const now = new Date().toISOString();
  savePromptTemplate(template, path);
  store.db.prepare('INSERT INTO prompt_presets(id,name,template,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, title, template, now, now);
  store.set('active_prompt_id', id);
  return { id, name: title, template };
}

export function renderPrompt(template, project, binding, defaults) {
  const values = {
    topic: project.topic,
    repository: binding.github_full_name,
    branch: binding.base_branch,
    folder: project.folder,
    runtime: defaults.runtime,
    development_seeds: defaults.developmentSeeds,
    final_seeds: defaults.finalSeeds
  };
  return validatePromptTemplate(template).replace(/{{\s*([^{}]+?)\s*}}/g, (_, name) => String(values[name]));
}
