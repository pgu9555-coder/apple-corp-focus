import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './background-harness.mjs';

test('background migrates camera on once and preserves later explicit off',async()=>{
 const shared={local:{},session:{}};
 const h=harness(shared);
 try{const r=await h.invoke({target:'worker',type:'get'});assert.equal(r.state.settings.eyeTracking,true);assert.equal(shared.local.eyeTrackingDefaultApplied,true);
 const off=await h.invoke({target:'worker',type:'timer-settings',settings:{eyeTracking:false}});assert.equal(off.ok,true);}finally{await h.close();}
 const h2=harness(shared);
 try{assert.equal((await h2.invoke({target:'worker',type:'get'})).state.settings.eyeTracking,false);}finally{await h2.close();}
});
test('background camera error pauses only after the camera has worked',async()=>{
 const h=harness();
 const sender={id:'test-extension',url:'chrome-extension://test-extension/offscreen.html'};
 try{
 await h.invoke({target:'worker',type:'start',kind:'focus'});
 assert.equal((await h.invoke({target:'worker',type:'attention-status',status:'watching'},sender)).ok,true);
 const reply=await h.invoke({target:'worker',type:'attention-status',status:'error'},sender);
 assert.equal(reply.ok,true);
 const {state}=await h.invoke({target:'worker',type:'get'});
 assert.equal(state.session.pauseKind,'camera');assert.notEqual(state.session.pausedAt,null);
 }finally{await h.close();}
});
test('background camera that never worked turns eye tracking off for the session without pausing',async()=>{
 const h=harness();
 const sender={id:'test-extension',url:'chrome-extension://test-extension/offscreen.html'};
 try{
 await h.invoke({target:'worker',type:'start',kind:'focus'});
 const reply=await h.invoke({target:'worker',type:'attention-status',status:'denied'},sender);
 assert.equal(reply.ok,true);
 const {state}=await h.invoke({target:'worker',type:'get'});
 assert.equal(state.session.pausedAt,null);assert.equal(state.session.eyeTracking,false);assert.equal(state.settings.eyeTracking,true);
 }finally{await h.close();}
});
test('focused warning window does not count as leaving blocked website',async()=>{
 const h=harness();
 let popup=null;const base=h.chrome.windows.getAll;
 h.chrome.windows.getAll=async()=>{const windows=await base();if(popup){windows.forEach(w=>w.focused=false);windows.push(popup);}return windows;};
 h.chrome.windows.create=async options=>{popup={id:2,focused:true,type:'popup',tabs:[{id:2,windowId:2,active:true,url:options.url}]};return popup;};
 h.chrome.windows.update=async()=>{};
 try{
 await h.invoke({target:'worker',type:'start',kind:'focus'});
 await h.navigate('https://youtube.com/');
 await h.flush();
 assert.ok(popup);assert.equal(new URL(popup.tabs[0].url).searchParams.get('source'),'1');
 h.advance(2000);
 const {state}=await h.invoke({target:'worker',type:'get'});
 assert.equal(state.session.siteWarning.host,'youtube.com');assert.equal(state.session.pausedAt,null);
 }finally{await h.close();}
});
