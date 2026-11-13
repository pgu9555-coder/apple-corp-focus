import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './background-harness.mjs';

test('eye-tracking choice No turns the camera off, is remembered, and is reported by get',async()=>{
 const shared={local:{},session:{}};
 const h=harness(shared);
 try{
  const before=await h.invoke({target:'worker',type:'get'});
  assert.equal(before.state.eyeTrackingChoiceMade,false);
  const reply=await h.invoke({target:'worker',type:'eye-tracking-choice',enabled:false});
  assert.equal(reply.ok,true);
  assert.equal(reply.state.settings.eyeTracking,false);
  assert.equal(reply.state.eyeTrackingChoiceMade,true);
  assert.equal(shared.local.eyeTrackingChoiceMade,true);
 }finally{await h.close();}
 const h2=harness(shared);
 try{
  const {state}=await h2.invoke({target:'worker',type:'get'});
  assert.equal(state.eyeTrackingChoiceMade,true);
  assert.equal(state.settings.eyeTracking,false);
 }finally{await h2.close();}
});
test('eye-tracking choice Yes keeps the camera on and opens camera setup',async()=>{
 const h=harness();
 const created=[];const base=h.chrome.tabs.create;
 h.chrome.tabs.create=async options=>{created.push(options);return base(options);};
 try{
  const reply=await h.invoke({target:'worker',type:'eye-tracking-choice',enabled:true});
  assert.equal(reply.ok,true);
  assert.equal(reply.state.settings.eyeTracking,true);
  assert.equal(reply.state.eyeTrackingChoiceMade,true);
  assert.equal(created.length,1);
  assert.match(created[0].url,/camera\.html$/);
 }finally{await h.close();}
});
test('eye-tracking choice during a live block records the answer without changing locked settings',async()=>{
 const h=harness();
 try{
  await h.invoke({target:'worker',type:'eye-tracking-choice',enabled:false});
  const started=await h.invoke({target:'worker',type:'start',kind:'focus'});
  assert.equal(started.ok,true);
  const reply=await h.invoke({target:'worker',type:'eye-tracking-choice',enabled:true});
  assert.equal(reply.ok,true);
  assert.equal(reply.state.settings.eyeTracking,false);
  assert.equal(reply.state.eyeTrackingChoiceMade,true);
 }finally{await h.close();}
});
test('saving the camera preference counts as the answer; other saves do not',async()=>{
 const h=harness();
 try{
  const other=await h.invoke({target:'worker',type:'timer-settings',settings:{focusMinutes:30}});
  assert.equal(other.ok,true);
  assert.equal(other.state.eyeTrackingChoiceMade,false);
  const pref=await h.invoke({target:'worker',type:'timer-settings',settings:{eyeTracking:false}});
  assert.equal(pref.ok,true);
  assert.equal(pref.state.eyeTrackingChoiceMade,true);
  const {state}=await h.invoke({target:'worker',type:'get'});
  assert.equal(state.eyeTrackingChoiceMade,true);
 }finally{await h.close();}
});
