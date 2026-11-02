import test from 'node:test';
import assert from 'node:assert/strict';
import {warningOrigins} from '../extension/page-warnings.js';
import vm from 'node:vm';
import fs from 'node:fs';
import * as core from '../extension/core.js';

function element(id='') {
  const listeners={};
  return {id,hidden:false,disabled:false,value:'',checked:false,textContent:'',title:'',dataset:{},style:{},children:[],returnValue:'',classList:{contains:()=>id==='body',add(){},toggle(){}},
    addEventListener:(type,fn)=>{(listeners[type]??=[]).push(fn);},fire(type,event={}){for(const fn of listeners[type]||[])fn(event);},append(...nodes){this.children.push(...nodes);},appendChild(node){this.children.push(node);},replaceChildren(...nodes){this.children=[...nodes];},setAttribute(){},showModal(){this.open=true;},click(){this.fire('click',{preventDefault(){},stopPropagation(){}})}};
}
function harness() {
  const elements=new Map(), messages=[];
  let failSave=false;
  const body=element('body'), head=element('head'); body.classList={contains:x=>x==='popup',add(){},toggle(){}};
  const document={body,head,getElementById(id){if(!elements.has(id))elements.set(id,element(id));return elements.get(id);},createElement:tag=>element(tag),querySelectorAll:()=>[]};
  const state={schema:5,settings:{focusMinutes:25,breakMinutes:5,timerMode:'flow',sound:true,requireArduino:false,blockedHosts:['bad.test']},presets:[{id:'25-5',focusMinutes:25,breakMinutes:5},{id:'50-10',focusMinutes:50,breakMinutes:10}],session:null,stats:{completed:0},restMs:0,ledger:{earned:0,claims:[]},history:[],ui:{view:'ready'}};
  const chrome={runtime:{sendMessage:async msg=>{messages.push(msg);if(msg.type==='get')return {ok:true,state:structuredClone(state)};if(msg.type==='timer-settings'){if(failSave)return {ok:false,error:'Settings could not be saved.'};Object.assign(state.settings,msg.settings);return {ok:true,state:structuredClone(state)};}if(msg.type==='start'){state.session={kind:'focus',phase:'focus',durationMs:Number(msg.settings.focusMinutes)*60000,effectiveMs:0,goalReached:false,pausedAt:null,accountedAt:Date.now(),timerMode:'flow'};return {ok:true,state:structuredClone(state)};}if(msg.type==='save-preset'){state.presets.push({id:`${msg.preset.focusMinutes}-${msg.preset.breakMinutes}`,...msg.preset});return {ok:true,state:structuredClone(state)};}if(msg.type==='delete-preset'){state.presets=state.presets.filter(x=>x.id!==msg.id);return {ok:true,state:structuredClone(state)};}if(msg.type==='cancel')return {ok:true,state:structuredClone(state)};return {ok:true,state:structuredClone(state)};}},permissions:{request:async options=>{messages.push({type:'permissions-request',options});return true;}},storage:{onChanged:{addListener(){}}}};
  const context={document,chrome,console,Date,URL,structuredClone,Set,Math,Number,JSON,Promise,Error,setInterval(){},clearInterval,setTimeout,clearTimeout,
    LIVE:core.LIVE,remaining:core.remaining,elapsed:core.elapsed,formatTime:core.formatTime,isPaused:core.isPaused,isWarning:core.isWarning,warningRemaining:core.warningRemaining,warningOrigins,settingsFrom:o=>({...o,focusMinutes:Number(o.focusMinutes),breakMinutes:Number(o.breakMinutes)}),rewardSummary:s=>({available:s.ledger.earned-(s.ledger.claims||[]).length,unconfirmed:0,confirmed:0})};
  let source=fs.readFileSync(new URL('../extension/ui.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/^if \(document\.body\?\.classList[^\n]+\n/,'').replace('export async function ask','async function ask');
  vm.runInNewContext(`${source}\nglobalThis.__uiRender=render;`,context,{filename:'ui.js',importModuleDynamically:async()=>({})});
  return {elements,messages,state,setFailSave:value=>{failSave=value;},fire:(id,type,e={})=>elements.get(id)?.fire(type,e),render:next=>context.__uiRender(next)};
}

test('autosave sends only timer fields and no blockedHosts',async()=>{const h=harness();await new Promise(r=>setImmediate(r));h.elements.get('focus-minutes').value='100';h.fire('focus-minutes','input');h.fire('focus-minutes','change');await new Promise(r=>setTimeout(r,350));const save=h.messages.find(m=>m.type==='timer-settings');assert.ok(save);assert.deepEqual(Object.keys(save.settings).sort(),['breakMinutes','focusMinutes','timerMode']);assert.equal('blockedHosts' in save.settings,false);});
test('start after editing submits current values without waiting forever',async()=>{const h=harness();await new Promise(r=>setImmediate(r));h.elements.get('focus-minutes').value='100';h.elements.get('break-minutes').value='10';h.fire('focus-minutes','input');h.fire('break-minutes','input');const start=Promise.resolve(h.fire('start','click'));await Promise.race([start,new Promise((_,reject)=>setTimeout(()=>reject(Error('start hung')),500))]);await new Promise(r=>setImmediate(r));const msg=h.messages.find(m=>m.type==='start');assert.equal(msg.settings.focusMinutes,100);assert.equal(msg.settings.breakMinutes,10);});
test('finish is hidden before goal and visible after goal',async()=>{
  const h=harness();await new Promise(r=>setImmediate(r));
  h.state.session={kind:'focus',phase:'focus',durationMs:600000,effectiveMs:0,goalReached:false,pausedAt:null,accountedAt:Date.now(),timerMode:'flow'};
  h.state.ui={view:'session'};h.render(structuredClone(h.state));
  assert.equal(h.elements.get('finish').hidden,true);
  assert.equal(h.elements.get('cancel').hidden,false);
  h.state.session.goalReached=true;h.state.session.effectiveMs=600000;
  h.render(structuredClone(h.state));
  assert.equal(h.elements.get('finish').hidden,false);
  assert.equal(h.elements.get('cancel').hidden,true);
});
test('polling does not overwrite a newer edited draft',async()=>{
  const h=harness();await new Promise(r=>setImmediate(r));
  h.elements.get('focus-minutes').value='100';h.fire('focus-minutes','input');
  h.state.settings.focusMinutes=50;h.render(structuredClone(h.state));
  assert.equal(h.elements.get('focus-minutes').value,'100');
  h.fire('start','click');await new Promise(r=>setImmediate(r));
  assert.equal(h.messages.find(m=>m.type==='start').settings.focusMinutes,100);
});
test('cancel dialog only sends confirmed cancel when explicitly confirmed',async()=>{
  const h=harness();await new Promise(r=>setImmediate(r));
  h.fire('cancel','click');assert.equal(h.elements.get('cancel-dialog').open,true);
  h.elements.get('cancel-dialog').returnValue='cancel';h.fire('cancel-dialog','close');
  await new Promise(r=>setImmediate(r));assert.equal(h.messages.some(m=>m.type==='cancel'),false);
  h.elements.get('cancel-dialog').returnValue='confirm';h.fire('cancel-dialog','close');
  await new Promise(r=>setImmediate(r));assert.equal(h.messages.find(m=>m.type==='cancel').confirmed,true);
});
test('paused reason is rendered instead of generic text',async()=>{const h=harness();await new Promise(r=>setImmediate(r));h.state.session={kind:'focus',phase:'focus',durationMs:600000,effectiveMs:1000,goalReached:false,pausedAt:1,accountedAt:1,reason:'Chrome restarted; unobserved time was excluded.',timerMode:'flow'};h.state.ui={view:'session'};h.render(structuredClone(h.state));assert.match(h.elements.get('message').textContent,/Chrome restarted/);});
test('blocked-site grace warning freezes focus and shows countdown',async()=>{const h=harness();await new Promise(r=>setImmediate(r));const now=Date.now();h.state.session={kind:'focus',phase:'focus',durationMs:600000,effectiveMs:120000,goalReached:false,pausedAt:null,accountedAt:now,lastCheckAt:now,siteWarning:{host:'youtube.com',startedAt:now,deadlineAt:now+8000},timerMode:'flow'};h.state.ui={view:'session'};h.render(structuredClone(h.state));assert.equal(h.elements.get('phase').textContent,'LEAVE BLOCKED SITE');assert.equal(h.elements.get('timer').textContent,'00:08');assert.match(h.elements.get('message').textContent,/youtube\.com/);assert.match(h.elements.get('message').textContent,/frozen/);assert.equal(h.elements.get('effective-time').textContent,'02:00');});
test('failed warning keeps earned reward count visible',async()=>{const h=harness();await new Promise(r=>setImmediate(r));h.state.session={kind:'focus',phase:'failed',durationMs:60000,effectiveMs:60000,rewardsAwarded:2,goalReached:true,pausedAt:null,accountedAt:Date.now(),timerMode:'flow'};h.state.history=[{type:'failed',focusMinutes:1,effectiveMs:0,rewardsKept:2,reason:'Focus stopped after the warning.'}];h.state.ui={view:'session'};h.render(structuredClone(h.state));assert.match(h.elements.get('history-list').children[0].textContent,/Reward kept/);});
test('flow labels rewards by earned count instead of fixed one',async()=>{const h=harness();await new Promise(r=>setImmediate(r));h.state.session={kind:'focus',phase:'focus',durationMs:60000,effectiveMs:125000,rewardsAwarded:2,goalReached:true,pausedAt:null,accountedAt:Date.now(),timerMode:'flow'};h.state.ui={view:'session'};h.render(structuredClone(h.state));assert.match(h.elements.get('goal-label').textContent,/2 rewards earned/);assert.match(h.elements.get('goal-label').textContent,/next at 03:00/);h.state.ledger.earned=2;h.render(structuredClone(h.state));assert.match(h.elements.get('reward-detail').textContent,/2 earned rewards/);});
test('preset delete uses delete-preset message with its id',async()=>{const h=harness();await new Promise(r=>setImmediate(r));const row=h.elements.get('preset-row');const remove=row.children[0].children[1];remove.fire('click',{stopPropagation(){}});await new Promise(r=>setImmediate(r));assert.ok(h.messages.some(m=>m.type==='delete-preset'&&m.id==='25-5'));});

test('Pomodoro goal does not advertise an additional reward',async()=>{const h=harness();await new Promise(r=>setImmediate(r));h.state.session={kind:'focus',phase:'focus',durationMs:1500000,effectiveMs:1500000,rewardsAwarded:1,goalReached:true,pausedAt:null,accountedAt:Date.now(),timerMode:'pomodoro'};h.state.ui={view:'session'};h.render(structuredClone(h.state));assert.match(h.elements.get('goal-label').textContent,/Goal complete|1 reward earned/);assert.doesNotMatch(h.elements.get('goal-label').textContent,/Next reward/);});
test('autosave failure clears Saving status and offers retry',async()=>{const h=harness();await new Promise(r=>setImmediate(r));h.setFailSave(true);h.elements.get('focus-minutes').value='100';h.fire('focus-minutes','input');await new Promise(r=>setTimeout(r,350));assert.match(h.elements.get('saved').textContent,/Not saved|Retry/);});
test('render preserves preset button identity when presets are unchanged',async()=>{const h=harness();await new Promise(r=>setImmediate(r));const row=h.elements.get('preset-row'),first=row.children[0];h.render(structuredClone(h.state));assert.equal(row.children[0],first);});
test('page-warning permission request uses only blocked-site origins',async()=>{const h=harness();await new Promise(r=>setImmediate(r));h.fire('enable-page-warnings','click');await new Promise(r=>setImmediate(r));const request=h.messages.find(m=>m.type==='permissions-request');assert.deepEqual([...request.options.origins],['http://*.bad.test/*','https://*.bad.test/*']);});
test('goal completion offers finish-and-break action',async()=>{const h=harness();await new Promise(r=>setImmediate(r));h.state.session={kind:'focus',phase:'focus',durationMs:60000,effectiveMs:60000,rewardsAwarded:1,goalReached:true,pausedAt:null,accountedAt:Date.now(),timerMode:'flow'};h.state.restMs=300000;h.state.ui={view:'session'};h.render(structuredClone(h.state));assert.equal(h.elements.get('finish').textContent,'Finish & take a break');h.fire('finish','click');await new Promise(r=>setImmediate(r));assert.ok(h.messages.some(m=>m.type==='finish-break'));});
test('goal completion also offers finishing without a break',async()=>{const h=harness();await new Promise(r=>setImmediate(r));h.state.session={kind:'focus',phase:'focus',durationMs:60000,effectiveMs:60000,rewardsAwarded:1,goalReached:true,pausedAt:null,accountedAt:Date.now(),timerMode:'flow'};h.state.restMs=300000;h.state.ui={view:'session'};h.render(structuredClone(h.state));assert.equal(h.elements.get('finish-without-break').hidden,false);h.fire('finish-without-break','click');await new Promise(r=>setImmediate(r));assert.ok(h.messages.some(m=>m.type==='finish'));});
test('mode help describes Flow and Pomodoro reward rules',async()=>{const h=harness();await new Promise(r=>setImmediate(r));assert.match(h.elements.get('mode-help').textContent,/Quiet Flow.*one reward.*selected interval/i);h.state.settings.timerMode='pomodoro';h.render(structuredClone(h.state));assert.match(h.elements.get('mode-help').textContent,/Pomodoro.*one reward.*run/i);});
test('autosave retry control retries after failure',async()=>{const h=harness();await new Promise(r=>setImmediate(r));h.setFailSave(true);h.elements.get('focus-minutes').value='100';h.fire('focus-minutes','input');await new Promise(r=>setTimeout(r,350));assert.equal(h.elements.get('retry-save').hidden,false);const before=h.messages.filter(m=>m.type==='timer-settings').length;h.setFailSave(false);h.fire('retry-save','click');await new Promise(r=>setTimeout(r,350));assert.ok(h.messages.filter(m=>m.type==='timer-settings').length>before);});
test('reward panel separates this run from available bank',async()=>{const h=harness();await new Promise(r=>setImmediate(r));h.state.session={kind:'focus',phase:'focus',durationMs:60000,effectiveMs:60000,rewardsAwarded:2,goalReached:true,pausedAt:null,accountedAt:Date.now(),timerMode:'flow'};h.state.ledger.earned=5;h.state.ui={view:'session'};h.render(structuredClone(h.state));assert.equal(h.elements.get('run-rewards').textContent,'This run: 2 earned');assert.equal(h.elements.get('reward-available').textContent,'5');assert.match(h.elements.get('completed').textContent,/Total earned: 5/);});

test('Flow milestone holds at zero pending confirmation instead of showing elapsed as countdown',async()=>{
  const h=harness();await new Promise(r=>setImmediate(r));
  h.state.session={kind:'focus',phase:'focus',durationMs:60000,effectiveMs:120000,rewardsAwarded:1,goalReached:true,pausedAt:null,accountedAt:Date.now(),timerMode:'flow'};
  h.state.ui={view:'session'};h.render(structuredClone(h.state));
  assert.equal(h.elements.get('timer').textContent,'00:00');
  assert.equal(h.elements.get('timer-caption').textContent,'Confirming reward…');
  assert.equal(h.elements.get('run-rewards').textContent,'This run: 1 earned');
});

test('setup and breaks do not label a previous focus as the current run',async()=>{
  const h=harness();await new Promise(r=>setImmediate(r));
  h.state.ledger.earned=3;
  h.state.session={kind:'focus',phase:'completed',durationMs:60000,effectiveMs:180000,rewardsAwarded:3,goalReached:true};
  h.state.ui={view:'ready'};h.render(structuredClone(h.state));
  assert.equal(h.elements.get('run-rewards').hidden,true);
  h.state.session={kind:'break',phase:'break',durationMs:300000,effectiveMs:0,rewardsAwarded:0,accountedAt:Date.now()};
  h.state.ui={view:'session'};h.render(structuredClone(h.state));
  assert.equal(h.elements.get('run-rewards').hidden,true);
  assert.equal(h.elements.get('reward-available').textContent,'3');
});
