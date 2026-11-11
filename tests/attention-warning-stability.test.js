import test from 'node:test';
import assert from 'node:assert/strict';
import {Controller,initialState} from '../extension/core.js';
import {AttentionMonitor,classifyFrame} from '../extension/attention.js';
import {WarningWindow,focusNotice} from '../extension/warning-window.js';

function setup(){
 let now=1000,host='https://study.test/';
 const c=new Controller({now:()=>now,uuid:()=> 'session',hardware:()=>({}),active:async()=>({urls:[host]}),save:async()=>{},schedule:async()=>{}});
 return {c,advance:ms=>{now+=ms;},host:url=>{host=url;}};
}
test('default camera is on, explicit off survives loading',async()=>{
 const {c}=setup();assert.equal(c.state.settings.eyeTracking,true);
 const saved=initialState();saved.settings.eyeTracking=false;
 await c.load(saved,true);assert.equal(c.state.settings.eyeTracking,false);
});
test('activity race retries the actual host instead of failing',async()=>{
 const {c}=setup();let reads=0;
 c.io.active=async()=>{if(reads++===0)c.revision++;return {urls:['https://youtube.com/']};};
 assert.equal(await c.freshHost(['youtube.com']),'youtube.com');
 assert.equal(reads,2);
});
test('persistent activity churn returns typed retry signal',async()=>{
 const {c}=setup();
 c.io.active=async()=>{c.revision++;return {urls:[]};};
 await assert.rejects(c.freshHost([]),e=>e.code==='BROWSER_ACTIVITY_CHANGED');
});
test('away grace freezes, returns, pauses at deadline, resumes, manual pause stays paused',async()=>{
 const {c,advance}=setup();await c.start();
 advance(1000);await c.attention(false);
 const frozen=c.state.session.effectiveMs;const until=c.state.session.awayWarning.deadlineAt;
 advance(2000);await c.attention(true);
 assert.equal(c.state.session.awayWarning,null);assert.equal(c.state.session.effectiveMs,frozen);
 await c.attention(false);advance(10000);await c.tick();
 assert.equal(c.state.session.pauseKind,'away');assert.equal(focusNotice(c.state.session).kind,'paused');
 await c.attention(true);assert.equal(c.state.session.pausedAt,null);
 await c.pause(true);await c.attention(true);assert.notEqual(c.state.session.pausedAt,null);
 assert.ok(until>1000);
});
test('website grace takes priority and keeps original deadline across blocked sites',async()=>{
 const {c,advance,host}=setup();await c.start();
 host('https://youtube.com');await c.visit('https://youtube.com');
 const deadline=c.state.session.siteWarning.deadlineAt;
 await c.attention(false);assert.equal(c.state.session.awayWarning,null);
 advance(2000);host('https://reddit.com');await c.visit('https://reddit.com');
 assert.equal(c.state.session.siteWarning.deadlineAt,deadline);
 advance(8000);await c.tick();assert.equal(c.state.session.phase,'failed');
 assert.equal(focusNotice(c.state.session).kind,'ended');
});
test('website safe leave clears grace without losing earned time',async()=>{
 const {c,advance,host}=setup();await c.start();advance(1000);
 host('https://youtube.com');await c.visit('https://youtube.com');
 const frozen=c.state.session.effectiveMs;
 advance(3000);host('https://study.test');await c.visit('https://study.test');
 assert.equal(c.state.session.siteWarning,null);assert.equal(c.state.session.effectiveMs,frozen);
});
test('camera pause requires manual recovery and displays camera warning',async()=>{
 const {c}=setup();await c.start();await c.autoPause('Camera failed','camera');
 assert.equal(focusNotice(c.state.session).kind,'camera');
 await c.attention(true);assert.notEqual(c.state.session.pausedAt,null);
});
test('17 degree downward relative pitch triggers, small movement does not',()=>{
 const result=pitch=>({faceLandmarks:[[]],facialTransformationMatrixes:[{data:[1,0,0,0,0,Math.cos(pitch*Math.PI/180),Math.sin(pitch*Math.PI/180),0,0,0,1,0,0,0,0,1]}]});
 const baseline={yaw:0,pitch:-2,blink:0};
 assert.equal(classifyFrame(result(19),{},baseline).reason,'turned');
 assert.equal(classifyFrame(result(8),{},baseline).reason,'ok');
});
test('stalled frames stop camera, report error, and never emit present heartbeat',()=>{
 let stopped=0,signal=0,status;
 const m=new AttentionMonitor({video:{readyState:0,srcObject:{}},onStatus:s=>status=s,onChange:()=>signal++});
 m.running=true;m.clock={postMessage(){}};m.lastFrameAt=performance.now()-6000;
 m.stream={getTracks:()=>[{stop:()=>stopped++}]};
 m.tick();assert.equal(status,'error');assert.equal(m.running,false);assert.equal(stopped,1);assert.equal(signal,0);
});
test('stop during pending permission disposes the late stream',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 let grant,stopped=0,status;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>new Promise(r=>grant=r)}}});
 try{
 const m=new AttentionMonitor({onStatus:s=>status=s});
 const start=m.start();m.stop();grant({getTracks:()=>[{stop:()=>stopped++}]});await start;
 assert.equal(stopped,1);assert.equal(status,'off');assert.equal(m.running,false);
 }finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
test('popup is deduplicated, tracks source window, and only opens for a notice',async()=>{
 let session={id:'a',phase:'focus',awayWarning:{deadlineAt:10000}},created=[];
 const api={runtime:{getURL:p=>'chrome-extension://x/'+p},windows:{getAll:async()=>[{id:8,focused:true,tabs:[{active:true,url:'https://study.test'}]}],create:async x=>created.push(x)}};
 const w=new WarningWindow(api,()=>session);
 await Promise.all([w.refresh(),w.refresh()]);assert.equal(created.length,1);
 assert.equal(new URL(created[0].url).searchParams.get('source'),'8');
 session={id:'a',phase:'focus'};await w.refresh();assert.equal(created.length,1);
 session.awayWarning={deadlineAt:20000};await w.refresh();assert.equal(created.length,2);
});
test('queued popup is not opened after warning already cleared',async()=>{
 let session={id:'a',phase:'focus',awayWarning:{deadlineAt:10000}},created=0;
 const api={runtime:{getURL:p=>'chrome-extension://x/'+p},windows:{getAll:async()=>{session={id:'a',phase:'focus'};return [];},create:async()=>created++}};
 await new WarningWindow(api,()=>session).refresh();assert.equal(created,0);
});
