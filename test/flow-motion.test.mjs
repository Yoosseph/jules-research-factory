import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Load the browser's actual transfer clock without starting the page controller.
const { Traffic } = runInNewContext(`${readFileSync(new URL('../public/flow.js', import.meta.url), 'utf8')}\n({ Traffic: FlowTraffic })`, { document: { querySelector: () => null } });
function harness() {
  let callback, nextId = 0;
  const started = [], frames = [], finished = [];
  const traffic = new Traffic({
    requestFrame: next => { callback = next; return ++nextId; }, cancelFrame: () => { callback = null; },
    start: item => { started.push(item); return {}; },
    frame: (item, progress) => frames.push({ id: item.packet.id, progress }),
    finish: item => finished.push(item.packet.id)
  });
  return { traffic, started, frames, finished, step(time) { const next = callback; callback = null; next?.(time); } };
}

test('recorded transfers move concurrently and every burst packet reaches the diagram', () => {
  const view = harness();
  const packets = Array.from({ length: 45 }, (_, index) => ({ id: `event:${index}` }));
  view.traffic.enqueue(packets);
  let peak = 0;
  for (let time = 0; time <= 30000; time += 100) { view.step(time); peak = Math.max(peak, view.traffic.active.length); }
  assert.ok(peak > 1 && peak <= 10);
  assert.equal(view.started.length, 45);
  assert.equal(new Set(view.finished).size, 45);
  assert.ok(view.frames.some(frame => frame.progress > 0 && frame.progress < 1));
  assert.equal(view.traffic.queue.length, 0);
  assert.equal(view.traffic.active.length, 0);
});

test('pause and hidden tabs freeze transfers and resume without skipping their travel', () => {
  const view = harness();
  view.traffic.enqueue([{ id: 'message' }]); view.step(0); view.step(1000);
  const before = view.frames.at(-1).progress;
  view.traffic.freeze('paused', true); view.step(50000);
  assert.equal(view.frames.at(-1).progress, before);
  assert.equal(view.finished.length, 0);
  view.traffic.freeze('paused', false); view.step(60000);
  assert.equal(view.frames.at(-1).progress, before);
  view.traffic.freeze('hidden', true); view.step(90000);
  view.traffic.freeze('hidden', false); view.step(100000); view.step(101000);
  assert.ok(view.frames.at(-1).progress > before && view.frames.at(-1).progress < 1);
  view.traffic.close(); assert.equal(view.finished.length, 1);
});

test('live arrivals take priority over queued replay and task filtering removes unrelated traffic', () => {
  const view = harness();
  view.traffic.enqueue([{ id: 'old-1', projectId: 'one' }, { id: 'old-2', projectId: 'two' }], true);
  view.traffic.enqueue([{ id: 'new', projectId: 'one' }]); view.step(0);
  assert.equal(view.started[0].packet.id, 'new');
  assert.equal(view.started[0].replay, false);
  view.traffic.prune(packet => packet.projectId === 'one');
  for (let time = 700; time <= 7000; time += 100) view.step(time);
  assert.deepEqual(view.started.map(item => item.packet.id), ['new', 'old-1']);
  assert.equal(view.started[1].replay, true);
});

test('native frame callbacks keep their browser binding and an idle diagram stays idle', () => {
  let scheduled = 0, cancelled = 0;
  const browser = {
    document: { querySelector: () => null },
    requestAnimationFrame() { assert.equal(this, undefined); return ++scheduled; },
    cancelAnimationFrame() { assert.equal(this, undefined); cancelled++; }
  };
  // A native browser callback rejects a class instance as its receiver.
  // These strict stubs accept a free call, but reject a class instance receiver.
  const { Traffic: BrowserTraffic } = runInNewContext(`${readFileSync(new URL('../public/flow.js', import.meta.url), 'utf8')}\n({ Traffic: FlowTraffic })`, browser);
  const traffic = new BrowserTraffic({ start: () => ({}), frame: () => {}, finish: () => {} });
  traffic.schedule(); assert.equal(scheduled, 0);
  traffic.enqueue([{ id: 'real-message' }]); assert.equal(scheduled, 1);
  traffic.close(); assert.equal(cancelled, 1);
});
