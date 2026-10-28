import test from 'node:test';
import assert from 'node:assert/strict';
import {CUES,alertCue} from '../extension/audio.js';

const state=(session, sound=true)=>({settings:{sound},session});
test('cue routing: Pomodoro goal and completed break succeed',()=>{
  assert.equal(alertCue(state({kind:'focus',phase:'focus',timerMode:'pomodoro',goalReached:true})),'success');
  assert.equal(alertCue(state({kind:'break',phase:'completed'})),'success');
});
test('cue routing: Flow goal and manual focus completion stay silent',()=>{
  assert.equal(alertCue(state({kind:'focus',phase:'focus',timerMode:'flow',goalReached:true})),null);
  assert.equal(alertCue(state({kind:'focus',phase:'completed',timerMode:'pomodoro',goalReached:true})),null);
});
test('cue routing: failed and fault sessions use failure cue',()=>{
  assert.equal(alertCue(state({kind:'focus',phase:'failed'})),'failure');
  assert.equal(alertCue(state({kind:'focus',phase:'fault'})),'failure');
});
test('sound disabled suppresses every automatic cue',()=>{
  for(const session of [
    {kind:'focus',phase:'focus',timerMode:'pomodoro',goalReached:true},
    {kind:'break',phase:'completed'},
    {kind:'focus',phase:'failed'},
    {kind:'focus',phase:'fault'},
  ]) assert.equal(alertCue(state(session,false)),null);
});
test('success notes ascend and failure notes descend',()=>{
  assert.ok(CUES.success.every((n,i,a)=>i===0||n>a[i-1]));
  assert.ok(CUES.failure.every((n,i,a)=>i===0||n<a[i-1]));
});
