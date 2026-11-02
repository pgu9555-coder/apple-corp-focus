import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../extension/warning-banner.js', import.meta.url), 'utf8');

function harness() {
  let now = 1_000_000;
  const intervals = new Set();
  const cleared = [];
  const documentListeners = new Map();
  const runtimeListeners = [];
  const appended = [];
  const focusCalls = [];

  function element(tag) {
    return {
      tagName: tag,
      style: {},
      textContent: '',
      children: [],
      removed: false,
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
      remove() { this.removed = true; },
      setAttribute() {},
      attachShadow() {
        const shadow = element('shadow');
        this.shadowRoot = shadow;
        return shadow;
      },
    };
  }
  const document = {
    visibilityState: 'visible',
    documentElement: {append(node) { appended.push(node); }},
    createElement: element,
    addEventListener(type, fn) { documentListeners.set(type, fn); },
  };
  const chrome = {
    runtime: {
      id: 'test-extension',
      onMessage: {addListener(fn) { runtimeListeners.push(fn); }},
    },
  };
  const context = {
    chrome,
    document,
    Date: {now: () => now},
    setInterval(fn) { intervals.add(fn); return fn; },
    clearInterval(handle) { intervals.delete(handle); cleared.push(handle); },
    addEventListener(type, fn) { documentListeners.set(type, fn); },
    setNow(value) { now = value; },
    emit(message, sender = {id: 'test-extension'}) {
      for (const listener of runtimeListeners) listener(message, sender);
    },
    tick() { for (const fn of [...intervals]) fn(); },
    visibility(value) {
      document.visibilityState = value;
      documentListeners.get('visibilitychange')?.();
    },
    pagehide() { documentListeners.get('pagehide')?.(); },
    appended,
    runtimeListeners,
    intervals,
    cleared,
    focusCalls,
  };
  context.globalThis = context;
  context.window = {focus: () => focusCalls.push('focus')};
  vm.runInNewContext(source, context, {filename: 'warning-banner.js'});
  return context;
}

function banner(h) { return h.appended.at(-1); }
function heading(h) { return banner(h)?.shadowRoot.children[0].children[1]; }

test('warning banner accepts only trusted warning messages', () => {
  const h = harness();
  h.emit({type: 'apple-focus-warning', warning: {sessionId: 's1', deadlineAt: 1_009_000}}, {id: 'forged'});
  assert.equal(h.appended.length, 0);
  h.emit({type: 'apple-focus-warning', warning: {sessionId: 's1', deadlineAt: 1_009_000}});
  assert.equal(h.appended.length, 1);
  assert.match(heading(h).textContent, /Leave this site within/);
});

test('repeated script injection keeps one listener and one banner', () => {
  const h = harness();
  vm.runInNewContext(source, h, {filename: 'warning-banner-repeat.js'});
  assert.equal(h.runtimeListeners.length, 1);
  h.emit({type: 'apple-focus-warning', warning: {sessionId: 's1', deadlineAt: 1_009_000}});
  assert.equal(h.appended.length, 1);
  assert.equal(h.intervals.size, 1);
});

test('countdown renders without stealing focus', () => {
  const h = harness();
  h.emit({type: 'apple-focus-warning', warning: {sessionId: 's1', deadlineAt: 1_010_000}});
  assert.match(heading(h).textContent, /00:10/);
  h.setNow(1_008_100); h.tick();
  assert.match(heading(h).textContent, /00:02/);
  assert.deepEqual(h.focusCalls, []);
});

test('hidden visibility and pagehide remove the banner and clear its timer', () => {
  const h = harness();
  h.emit({type: 'apple-focus-warning', warning: {sessionId: 's1', deadlineAt: 1_010_000}});
  const node = banner(h);
  h.visibility('hidden');
  assert.equal(node.removed, true);
  assert.equal(h.intervals.size, 0);
  h.document.visibilityState = 'visible';
  h.emit({type: 'apple-focus-warning', warning: {sessionId: 's2', deadlineAt: 1_010_000}});
  const second = banner(h);
  h.pagehide();
  assert.equal(second.removed, true);
  assert.equal(h.intervals.size, 0);
});

test('clear message removes an active warning', () => {
  const h = harness();
  h.emit({type: 'apple-focus-warning', warning: {sessionId: 's1', deadlineAt: 1_010_000}});
  const node = banner(h);
  h.emit({type: 'apple-focus-warning'});
  assert.equal(node.removed, true);
  assert.equal(h.intervals.size, 0);
});

test('at deadline the banner only reports grace ended, then clears after five seconds', () => {
  const h = harness();
  h.emit({type: 'apple-focus-warning', warning: {sessionId: 's1', deadlineAt: 1_010_000}});
  h.setNow(1_010_000); h.tick();
  assert.equal(heading(h).textContent, 'Grace time ended');
  assert.equal(banner(h).removed, false);
  h.setNow(1_015_001); h.tick();
  assert.equal(banner(h).removed, true);
  assert.equal(h.intervals.size, 0);
});

test('expired and malformed warnings are rejected without rendering', () => {
  const h = harness();
  h.emit({type: 'apple-focus-warning', warning: {sessionId: 'old', deadlineAt: 999_999}});
  h.emit({type: 'apple-focus-warning', warning: {sessionId: 'bad', deadlineAt: 'later'}});
  h.emit({type: 'apple-focus-warning', warning: {sessionId: 'bad', deadlineAt: null}});
  assert.equal(h.appended.length, 0);
  assert.equal(h.intervals.size, 0);
});
