import test from 'node:test';
import assert from 'node:assert/strict';
import {Controller, isPaused, isWarning, rewardSummary} from '../extension/core.js';

function ioFactory() {
  let now = 0;
  let seq = 0;
  let active = {urls: []};
  return {
    now: () => now,
    setNow: value => { now = value; },
    advance: value => { now += value; },
    uuid: () => `${String(++seq).padStart(32, '0')}`,
    active: async () => active,
    setActive: urls => { active = {urls}; },
    hardware: () => ({connected: false}),
    save: async () => {},
    schedule: async () => {},
    alert: () => {},
  };
}

async function started(extra = {}) {
  const io = ioFactory();
  const controller = new Controller(io);
  await controller.settings({focusMinutes: 1, breakMinutes: 5, blockedHosts: [], ...extra});
  await controller.start('focus');
  return {controller, io};
}

test('finishAndBreak rejects an incomplete focus without reward or rest', async () => {
  const {controller, io} = await started();
  io.advance(30000);

  await assert.rejects(controller.finishAndBreak(), /goal|focus/i);
  assert.equal(controller.state.session.phase, 'focus');
  assert.equal(controller.state.ledger.earned, 0);
  assert.equal(controller.state.restMs, 0);
});

test('finishAndBreak finishes focus and starts the chosen break', async () => {
  const {controller, io} = await started();
  io.advance(60000);
  await controller.tick();
  assert.equal(controller.state.ledger.earned, 1);

  const before = controller.state.session.id;
  await controller.finishAndBreak();
  assert.equal(controller.state.session.kind, 'break');
  assert.equal(controller.state.session.phase, 'break');
  assert.notEqual(controller.state.session.id, before);
  assert.equal(controller.state.restMs, 0);
  assert.equal(controller.state.ledger.earned, 1);
});

test('finishAndBreak does not add a reward while transitioning', async () => {
  const {controller, io} = await started();
  io.advance(60000);
  await controller.tick();
  const earned = controller.state.ledger.earned;

  await controller.finishAndBreak();
  assert.equal(controller.state.ledger.earned, earned);
  assert.equal(controller.state.session.kind, 'break');
});

test('finishAndBreak rejects non-focus sessions and prevents a second transition', async () => {
  const {controller, io} = await started();
  io.advance(60000);
  await controller.tick();
  await controller.finishAndBreak();
  const breakId = controller.state.session.id;

  await assert.rejects(controller.finishAndBreak(), /focus|active/i);
  assert.equal(controller.state.session.phase, 'break');
  assert.equal(controller.state.session.id, breakId);
  assert.equal(controller.state.ledger.earned, 1);
});

test('finishAndBreak safely transitions a paused focus after its goal is earned', async () => {
  const {controller, io} = await started();
  io.advance(60000);
  await controller.tick();
  await controller.pause(true);
  assert.equal(isPaused(controller.state.session), true);

  await controller.finishAndBreak();
  assert.equal(controller.state.session.phase, 'break');
  assert.equal(controller.state.ledger.earned, 1);
});

test('finishAndBreak cannot start a break after a grace warning expires', async () => {
  const {controller, io} = await started({blockedHosts: ['bad.test']});
  io.advance(60000);
  await controller.tick();
  io.setActive(['https://bad.test']);
  await controller.visit('https://bad.test');
  assert.equal(isWarning(controller.state.session), true);
  io.advance(10000);

  await assert.rejects(controller.finishAndBreak(), /failed|goal|focus/i);
  assert.equal(controller.state.session.phase, 'failed');
  assert.equal(controller.state.session.kind, 'focus');
  assert.equal(controller.state.ledger.earned, 1);
  assert.equal(controller.state.restMs, 300000);
});

test('finishAndBreak may finish during grace and preserves the earned bank', async () => {
  const {controller, io} = await started({blockedHosts: ['bad.test']});
  io.advance(60000);
  await controller.tick();
  io.setActive(['https://bad.test']);
  await controller.visit('https://bad.test');
  assert.equal(isWarning(controller.state.session), true);
  io.advance(5000);

  await controller.finishAndBreak();
  assert.equal(controller.state.session.phase, 'break');
  assert.equal(controller.state.ledger.earned, 1);
  assert.equal(rewardSummary(controller.state).available, 1);
});
