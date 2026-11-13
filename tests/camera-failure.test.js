import test from 'node:test';
import assert from 'node:assert/strict';
import {Controller,isPaused,isAway} from '../extension/core.js';

function fakeIO(){let now=0,connected=true,active={urls:[]},result='DISPENSED',commandImpl=null;const saves=[],commands=[],alerts=[];return {now:()=>now,setNow:n=>now=n,advance:n=>now+=n,uuid:()=>`${String(saves.length+1).padStart(32,'0')}`,hardware:()=>({connected}),setConnected:v=>connected=v,active:async()=>active,setActive:v=>active={urls:v},save:async s=>{saves.push(structuredClone(s));},changed(){},schedule:async()=>{},alert:v=>alerts.push(v),command:async(...args)=>{commands.push(args);return commandImpl?commandImpl(...args):result;},setResult:v=>result=v,setCommand:v=>commandImpl=v,saves,commands,alerts};}
async function configured(extra={}){const io=fakeIO(),c=new Controller(io);await c.settings({focusMinutes:50,breakMinutes:10,blockedHosts:[],eyeTracking:true,...extra});return {io,c};}
async function advanceTime(io,c,ms){let left=ms;while(left>0){const step=Math.min(60000,left);io.advance(step);await c.tick();left-=step;}}

test('camera that never worked turns eye tracking off for the session without pausing',async()=>{
 const {io,c}=await configured();
 await c.start();await advanceTime(io,c,60000);
 await c.cameraUnavailable();
 assert.equal(isPaused(c.state.session),false);
 assert.equal(c.state.session.phase,'focus');
 assert.equal(c.state.session.eyeTracking,false);
 assert.equal(c.state.settings.eyeTracking,true);
 const before=c.state.session.effectiveMs;
 await advanceTime(io,c,60000);
 assert.equal(c.state.session.effectiveMs,before+60000);
 io.advance(1000);
 await c.attention(false);
 assert.equal(c.state.session.awayWarning,null);
 assert.equal(isAway(c.state.session),false);
 assert.equal(c.state.history[0].type,'camera-off');
 assert.match(c.state.session.reason,/Set up camera/);
});
test('camera that worked and then failed pauses once, then turns eye tracking off on the next failure',async()=>{
 const {io,c}=await configured();
 await c.start();await advanceTime(io,c,60000);
 await c.cameraWorking();
 assert.equal(c.state.session.cameraSeen,true);
 await c.cameraUnavailable();
 assert.equal(isPaused(c.state.session),true);
 assert.equal(c.state.session.pauseKind,'camera');
 assert.equal(c.state.session.cameraFailures,1);
 assert.equal(c.state.session.eyeTracking,true);
 await c.resume();
 assert.equal(isPaused(c.state.session),false);
 await c.cameraUnavailable();
 assert.equal(isPaused(c.state.session),false);
 assert.equal(c.state.session.eyeTracking,false);
 assert.equal(c.state.settings.eyeTracking,true);
 assert.equal(c.state.session.phase,'focus');
});
test('second camera failure while still paused for camera resumes with eye tracking off',async()=>{
 const {io,c}=await configured();
 await c.start();await advanceTime(io,c,60000);
 await c.cameraWorking();
 await c.cameraUnavailable();
 assert.equal(isPaused(c.state.session),true);
 await c.cameraUnavailable();
 assert.equal(isPaused(c.state.session),false);
 assert.equal(c.state.session.eyeTracking,false);
 assert.equal(c.state.settings.eyeTracking,true);
});
test('a camera failure during an away warning with no working camera clears the warning and does not credit frozen time',async()=>{
 const {io,c}=await configured();
 await c.start();await advanceTime(io,c,60000);
 await c.attention(false);
 assert.notEqual(c.state.session.awayWarning,null);
 const frozen=c.state.session.effectiveMs;
 io.advance(5000);
 await c.cameraUnavailable();
 assert.equal(c.state.session.awayWarning,null);
 assert.equal(isPaused(c.state.session),false);
 assert.equal(c.state.session.eyeTracking,false);
 assert.equal(c.state.session.effectiveMs,frozen);
 assert.equal(c.state.session.accountedAt,io.now());
 io.advance(3000);
 await c.tick();
 assert.equal(c.state.session.effectiveMs,frozen+3000);
});
test('camera calls are no-ops without a focus session or during a break',async()=>{
 const {io,c}=await configured({focusMinutes:1,breakMinutes:1});
 await c.cameraWorking();await c.cameraUnavailable();
 assert.equal(c.state.session,null);
 assert.equal(c.state.history.length,0);
 await c.start();await advanceTime(io,c,60000);await c.finish();
 const historyLength=c.state.history.length;
 await c.start('break');
 await c.cameraWorking();await c.cameraUnavailable();
 assert.equal(c.state.session.kind,'break');
 assert.equal(c.state.session.cameraSeen,undefined);
 assert.equal(c.state.session.eyeTracking,false);
 assert.equal(isPaused(c.state.session),false);
 assert.equal(c.state.history.length,historyLength);
});
test('new focus sessions start with camera tracking fields',async()=>{
 const {c}=await configured();
 await c.start();
 assert.equal(c.state.session.cameraSeen,false);
 assert.equal(c.state.session.cameraFailures,0);
});
