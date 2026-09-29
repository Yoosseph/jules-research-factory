import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/db.mjs';
import { initializePromptLibrary, promptLibrary, activatePrompt } from '../src/prompt.mjs';

test('first launch preserves an existing custom prompt and selects web research', () => {
  const directory = mkdtempSync(join(tmpdir(), 'researchforge-prompts-'));
  const store = openStore(directory);
  const path = join(directory, 'prompt-template.txt');
  const custom = 'Research {{topic}} in {{repository}} on {{branch}}. Write a careful answer inside {{folder}}/ with linked sources and state the limits of the available evidence.';
  try {
    writeFileSync(path, custom);
    initializePromptLibrary(store, path);
    const library = promptLibrary(store);
    assert.equal(library.activeId, 'web-research');
    assert.equal(library.presets.find(preset => preset.id === 'previous-prompt')?.template, custom);
    assert.match(readFileSync(path, 'utf8'), /web and literature research only/);
    activatePrompt(store, 'previous-prompt', path);
    assert.equal(readFileSync(path, 'utf8').trim(), custom);
    initializePromptLibrary(store, path);
    assert.equal(promptLibrary(store).activeId, 'previous-prompt');
  } finally {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('bundled web prompt upgrades without discarding its previous version', () => {
  const directory = mkdtempSync(join(tmpdir(), 'researchforge-prompt-upgrade-'));
  const store = openStore(directory);
  const path = join(directory, 'prompt-template.txt');
  const earlier = 'Research {{topic}} in {{repository}} on {{branch}}. Keep files inside {{folder}}/. Review web sources, cite findings, and explain uncertainty in the answer.';
  try {
    writeFileSync(path, readFileSync(new URL('../prompt-template.txt', import.meta.url)));
    initializePromptLibrary(store, path);
    store.db.prepare('UPDATE prompt_presets SET template=? WHERE id=?').run(earlier, 'web-research');
    store.set('web_prompt_version', '1');
    writeFileSync(path, earlier);
    initializePromptLibrary(store, path);
    const library = promptLibrary(store);
    assert.equal(library.activeId, 'web-research');
    assert.equal(library.presets.find(preset => preset.id === 'web-research-previous')?.template, earlier);
    assert.match(readFileSync(path, 'utf8'), /Search beyond the first page of results/);
  } finally {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
