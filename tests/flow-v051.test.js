import test from 'node:test';
import assert from 'node:assert/strict';
import {Controller,rewardSummary} from '../extension/core.js';

function ioFactory({connected=false}={}){
  let now=0;const saves=[];let seq=0;
  return {now:()=>now,setNow:v=>now=v,advance:v=>now+=v,uuid:()=>`${String(++seq).padStart(32,'0')}`,active:async()=>({urls:[]}),hardware:()=>({connected}),save:async s=>saves.push(structuredClone(s)),schedule:async()=>{},alert(){},command:async()=> 'SIMULATED',saves};
}
async function start(minutes=1,timerMode='flow',io=ioFactory()){const c=new Controller(io);await c.settings({focusMinutes:minutes,breakMinutes:5,timerMode,blockedHosts:[]});await c.start();return {c,io};}
async function tickAt(c,io,ms){while(io.now()<ms){io.setNow(Math.min(ms,io.now()+60000));await c.tick();}}

test('flow awards one reward at each full interval and is idempotent',async()=>{
  for(const [minutes,count] of [[1,2],[2,2],[3,3]]){const {c,io}=await start(minutes);for(let i=1;i<=count;i++){await tickAt(c,io,i*minutes*60000-1);assert.equal(rewardSummary(c.state).available,i-1);await tickAt(c,io,i*minutes*60000);assert.equal(rewardSummary(c.state).available,i);await c.tick();assert.equal(rewardSummary(c.state).available,i);}}
});

test('a trusted live-worker reload credits valid elapsed intervals, but restart gap does not',async()=>{
  const {c,io}=await start(1);await tickAt(c,io,60000);const saved=structuredClone(c.state);io.setNow(120000);const restored=new Controller(io);await restored.load(saved,true);await restored.tick();assert.equal(rewardSummary(restored.state).available,2);
  const gapSaved=structuredClone(restored.state);io.setNow(300000);const restarted=new Controller(io);await restarted.load(gapSaved,false);assert.equal(rewardSummary(restarted.state).available,2);assert.equal(restarted.state.session.pausedAt!=null,true);
});

test('pause time and partial intervals never earn credit or carry across runs',async()=>{
  const {c,io}=await start(1);io.setNow(30000);await c.tick();await c.pause(true);io.setNow(300000);await c.tick();assert.equal(rewardSummary(c.state).available,0);await c.resume();await tickAt(c,io,360000);assert.equal(rewardSummary(c.state).available,1);await c.finish();await c.prepareFocus();await c.start();assert.equal(c.state.session.rewardsAwarded,0);assert.equal(rewardSummary(c.state).available,1);
});

test('finish at 124 seconds credits exactly two one-minute rewards',async()=>{
  const {c,io}=await start(1);await tickAt(c,io,60000);await tickAt(c,io,124000);await c.finish();assert.equal(rewardSummary(c.state).available,2);assert.deepEqual(c.state.history.filter(h=>h.rewardDelta===1).map(h=>[h.type,h.intervalIndex,h.effectiveMs]),[['reward',2,120000],['completed',1,60000]]);
});

test('pomodoro remains capped at one reward per manual run',async()=>{
  const {c,io}=await start(1,'pomodoro');await tickAt(c,io,60000);await tickAt(c,io,120000);await tickAt(c,io,180000);assert.equal(rewardSummary(c.state).available,1);assert.equal(c.state.stats.completed,1);await c.tick();assert.equal(rewardSummary(c.state).available,1);
});

test('each reward can be claimed once and later rewards survive blocked focus',async()=>{
  const io=ioFactory({connected:true});const {c}=await start(1,'flow',io);await tickAt(c,io,60000);await tickAt(c,io,120000);await c.finish();await c.collect();await new Promise(setImmediate);await c.collect();await new Promise(setImmediate);await assert.rejects(c.collect(),/No reward/);await c.prepareFocus();await c.settings({blockedHosts:['bad.test']});await c.start();io.setNow(180000);await c.visit('https://bad.test');assert.equal(rewardSummary(c.state).available,0);assert.equal(c.state.stats.completed,1);
});

test('legacy active sessions normalize missing reward count without retro-crediting terminal records',async()=>{
  const io=ioFactory();const {c}=await start(1,'flow',io);await tickAt(c,io,60000);const saved=structuredClone(c.state);delete saved.session.rewardsAwarded;const restored=new Controller(io);await restored.load(saved,true);assert.equal(restored.state.session.rewardsAwarded,1);assert.equal(restored.state.ledger.earned,1);
  const terminal=structuredClone(restored.state);terminal.session.phase='completed';terminal.session.effectiveMs=180000;delete terminal.session.rewardsAwarded;const terminalReload=new Controller(io);await terminalReload.load(terminal,true);assert.equal(terminalReload.state.ledger.earned,1);assert.equal(terminalReload.state.session.rewardsAwarded,1);
});
