import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const interfaceScript = readFileSync(new URL('../public/interface.js', import.meta.url), 'utf8');
const themeScript = readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8');

function control(properties = {}) {
  const listeners = new Map();
  const attributes = new Map();
  return {
    ...properties,
    addEventListener: (name, listener) => listeners.set(name, listener),
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name),
    dispatch: (name, event = {}) => listeners.get(name)?.(event)
  };
}

test('provider and schedule choices show only their relevant fields', () => {
  const provider = control({ value: 'nvidia' });
  const mode = control({ value: 'continuous' });
  const endpoint = {};
  const interval = {};
  const controls = new Map([
    ['#provider', provider], ['[data-compatible-endpoint]', endpoint],
    ['#mode', mode], ['[data-scheduled-interval]', interval]
  ]);
  runInNewContext(interfaceScript, {
    window: {}, matchMedia: () => ({ matches: true }),
    document: { querySelector: selector => controls.get(selector), querySelectorAll: () => [] }
  });
  assert.equal(endpoint.hidden, true);
  assert.equal(interval.hidden, true);
  provider.value = 'compatible'; provider.dispatch('change');
  mode.value = 'scheduled'; mode.dispatch('change');
  assert.equal(endpoint.hidden, false);
  assert.equal(interval.hidden, false);
  provider.value = 'nvidia'; provider.dispatch('change');
  mode.value = 'continuous'; mode.dispatch('change');
  assert.equal(endpoint.hidden, true);
  assert.equal(interval.hidden, true);
});

test('pages without configuration controls still support cancelling stop confirmations', () => {
  const stop = control({ dataset: { confirm: 'Stop this task?' } });
  let confirmed = '', prevented = false;
  runInNewContext(interfaceScript, {
    window: {}, matchMedia: () => ({ matches: true }),
    document: { querySelector: () => null, querySelectorAll: selector => selector === '[data-confirm]' ? [stop] : [] },
    confirm: message => { confirmed = message; return false; }
  });
  stop.dispatch('click', { preventDefault: () => { prevented = true; } });
  assert.equal(confirmed, 'Stop this task?');
  assert.equal(prevented, true);
});

function themeHarness(saved, { dark = false, storageUnavailable = false } = {}) {
  const button = control();
  const preference = control({ matches: dark });
  const document = control({ documentElement: { dataset: {} }, querySelector: selector => selector === '[data-theme-toggle]' ? button : favicon });
  const global = control();
  const favicon = {};
  const stored = new Map(saved ? [['research-facility-theme', saved]] : []);
  runInNewContext(themeScript, {
    document, matchMedia: () => preference,
    addEventListener: global.addEventListener,
    localStorage: {
      getItem: key => { if (storageUnavailable) throw new Error('Storage unavailable'); return stored.get(key); },
      setItem: (key, value) => { if (storageUnavailable) throw new Error('Storage unavailable'); stored.set(key, value); }
    }
  });
  document.dispatch('DOMContentLoaded');
  return { document, button, favicon, preference, global, stored };
}

test('theme controls restore saved choices, persist switches, and synchronize tabs', () => {
  const view = themeHarness('dark');
  assert.equal(view.document.documentElement.dataset.theme, 'dark');
  assert.equal(view.favicon.href, '/favicon-dark.svg');
  assert.equal(view.button.getAttribute('aria-pressed'), 'true');
  assert.equal(view.button.getAttribute('aria-label'), 'Switch to light mode');
  view.button.dispatch('click');
  assert.equal(view.document.documentElement.dataset.theme, 'light');
  assert.equal(view.stored.get('research-facility-theme'), 'light');
  view.preference.dispatch('change', { matches: true });
  assert.equal(view.document.documentElement.dataset.theme, 'light');
  view.global.dispatch('storage', { key: 'research-facility-theme', newValue: 'dark' });
  assert.equal(view.document.documentElement.dataset.theme, 'dark');
  view.preference.matches = false;
  view.global.dispatch('storage', { key: 'research-facility-theme', newValue: null });
  assert.equal(view.document.documentElement.dataset.theme, 'light');
});

test('theme switches remain usable when browser storage is unavailable', () => {
  const view = themeHarness(undefined, { dark: true, storageUnavailable: true });
  assert.equal(view.document.documentElement.dataset.theme, 'dark');
  view.button.dispatch('click');
  assert.equal(view.document.documentElement.dataset.theme, 'light');
  assert.equal(view.favicon.href, '/favicon.svg');
  assert.equal(view.button.getAttribute('aria-pressed'), 'false');
});
