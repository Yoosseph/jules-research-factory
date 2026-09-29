import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const defaultPromptPath = join(import.meta.dirname, '..', 'prompt-template.txt');
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
