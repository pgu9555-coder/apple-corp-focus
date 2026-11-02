import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const bgPath=new URL('../extension/background.js',import.meta.url).href;
let importNumber=0;
class Event {constructor(){this.listeners=[];} addListener(fn){this.listeners.push(fn);} async emit(...args){for(const fn of this.listeners)await fn(...args);}}
function harness(shared={local:{},session:{}},options={}){
  let clock=Date.now(),tabId=1,windowId=1;const alarms=new Map(),sentMessages=[],injections=[];
  const windows=[{id:windowId,focused:true,type:'normal',tabs:[{id:tabId,windowId,active:true,url:'https://study.test/'}]}];
  const backing=shared;
  const runtime={id:'test-extension',onMessage:new Event(),onConnect:new Event(),onStartup:new Event(),getURL:p=>`chrome-extension://test-extension/${p}`,getContexts:async()=>[],sendMessage:async()=>({ok:true,value:{}})};
  const granted=options.permissions||[];
  const logs=[];const oldConsole=globalThis.console;
  if(options.captureWarnings)globalThis.console={...oldConsole,warn:(...args)=>logs.push(args),error:(...args)=>oldConsole.error(...args)};
  const permissions={onAdded:new Event(),onRemoved:new Event(),contains:async({origins})=>origins.every(origin=>granted.includes(origin)||granted.includes('*')||granted.includes(origin.replace(/^(https?:\/\/)/,'$1*.')))};
  const scripting={executeScript:async details=>{injections.push(details);if(options.scriptingError)throw Error('injection denied');}};
  const chrome={runtime,permissions,windows:{WINDOW_ID_NONE:-1,onFocusChanged:new Event(),onRemoved:new Event(),getAll:async()=>structuredClone(windows),get:async id=>windows.find(w=>w.id===id),update:async()=>{}},tabs:{onUpdated:new Event(),onActivated:new Event(),onReplaced:new Event(),get:async id=>windows.flatMap(w=>w.tabs).find(t=>t.id===id),query:async()=>windows.flatMap(w=>w.tabs).filter(t=>t.active),sendMessage:async(tabId,message)=>{sentMessages.push({tabId,message});},create:async()=>{},update:async()=>{}},webNavigation:{onBeforeNavigate:new Event(),onCommitted:new Event(),onHistoryStateUpdated:new Event()},alarms:{onAlarm:new Event(),create:async(name,opt)=>alarms.set(name,opt),clear:async name=>alarms.delete(name)},idle:{onStateChanged:new Event()},notifications:{onClicked:new Event(),create:async()=>'',getAll:async()=>({})},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{},openPopup:async()=>{}},offscreen:{createDocument:async()=>{},closeDocument:async()=>{}},storage:{local:{setAccessLevel:async()=>{},get:async key=>({state:backing.local.state}),set:async value=>Object.assign(backing.local,value)},session:{get:async key=>({browserSession:backing.session.browserSession}),set:async value=>Object.assign(backing.session,value)}},scripting};
  const oldNow=Date.now;Date.now=()=>clock;globalThis.chrome=chrome;
  const ready=import(`${bgPath}?test=${++importNumber}`);
  async function flush(){await ready;await new Promise(r=>setImmediate(r));}
  async function invoke(message,sender={id:'test-extension',url:'chrome-extension://test-extension/popup.html'}){await flush();return new Promise((resolve,reject)=>{let called=false;const respond=v=>{called=true;resolve(v);};try{const result=chrome.runtime.onMessage.listeners[0](message,sender,respond);if(result===false&&!called)resolve({ok:false,error:'not handled'});}catch(e){reject(e);}});}
  async function emit(event,...args){await flush();await event.emit(...args);await flush();}
  function setTime(ms){clock=ms;} function advance(ms){clock+=ms;}
  async function navigate(url){windows[0].tabs[0].url=url;await emit(chrome.webNavigation.onCommitted,{tabId:tabId,frameId:0,url});}
  async function activate(url){
    for(const tab of windows[0].tabs)tab.active=false;
    const nextTabId=windows[0].tabs.length+1;
    windows[0].tabs.push({id:nextTabId,windowId,active:true,url});
    await emit(chrome.tabs.onActivated,{tabId:nextTabId,windowId});
  }
  async function close(){Date.now=oldNow;if(options.captureWarnings)globalThis.console=oldConsole;}
  return {chrome,backing,ready,invoke,emit,setTime,advance,navigate,activate,flush,alarms,sentMessages,injections,logs,close};
}

test('background trusts extension messages, scopes settings, and drains concurrent queue',async()=>{
  const h=harness();
  try{
    const untrusted=await h.invoke({target:'worker',type:'get'},{id:'other',url:'https://evil.test/'});assert.equal(untrusted.ok,false);assert.match(untrusted.error,/Untrusted/);
    const timer=await h.invoke({target:'worker',type:'timer-settings',settings:{focusMinutes:100,breakMinutes:10}});assert.equal(timer.ok,true);assert.equal(timer.state.settings.focusMinutes,100);
    const scoped=await h.invoke({target:'worker',type:'timer-settings',settings:{focusMinutes:50,blockedHosts:['bad.test']}});assert.equal(scoped.ok,false);assert.match(scoped.error,/outside|setting/i);
    const web=await h.invoke({target:'worker',type:'website-settings',settings:{blockedHosts:['bad.test']}});assert.equal(web.ok,true);assert.equal(web.state.settings.focusMinutes,100);
    const [saved,started]=await Promise.all([h.invoke({target:'worker',type:'save-preset',preset:{focusMinutes:120,breakMinutes:12}}),h.invoke({target:'worker',type:'start',kind:'focus'})]);
    assert.equal(saved.ok,true);assert.equal(started.ok,true);assert.equal(started.state.session.focusMinutes,100);assert.equal(started.state.settings.blockedHosts.includes('bad.test'),true);
    const p=await h.invoke({target:'worker',type:'delete-preset',id:'120-12'});assert.equal(p.ok,true);assert.equal(p.state.presets.some(x=>x.focusMinutes===120),false);
  }finally{await h.close();}
});

test('background routes 100-minute goal, rejects early finish, and requires confirmed cancel',async()=>{
  const h=harness();
  try{
    await h.invoke({target:'worker',type:'timer-settings',settings:{focusMinutes:100,breakMinutes:10}});await h.invoke({target:'worker',type:'start',kind:'focus'});
    h.advance(99*60000+59000);let state=(await h.invoke({target:'worker',type:'get'})).state;assert.equal(state.ledger.earned,0);assert.equal(state.session.phase,'focus');
    let reply=await h.invoke({target:'worker',type:'finish'});assert.equal(reply.ok,false);assert.match(reply.error,/goal|Cancel/);
    reply=await h.invoke({target:'worker',type:'cancel',confirmed:false});assert.equal(reply.ok,false);assert.match(reply.error,/confirmation/i);
    reply=await h.invoke({target:'worker',type:'cancel',confirmed:true});assert.equal(reply.ok,true);assert.equal(reply.state.ledger.earned,0);assert.equal(reply.state.restMs,0);assert.equal(reply.state.session,null);
  }finally{await h.close();}
});

test('lock and browser-session restart pause at trusted checkpoint without credit',async()=>{
  const shared={local:{},session:{}};const first=harness(shared);
  try{
    await first.invoke({target:'worker',type:'timer-settings',settings:{focusMinutes:100,breakMinutes:10}});await first.invoke({target:'worker',type:'start',kind:'focus'});first.advance(60000);let before=(await first.invoke({target:'worker',type:'get'})).state.session.effectiveMs;assert.ok(before>=59000);
    await first.emit(first.chrome.idle.onStateChanged,'locked');first.advance(3600000);let locked=(await first.invoke({target:'worker',type:'get'})).state;assert.equal(locked.session.pausedAt!=null,true);assert.equal(locked.session.effectiveMs,before);assert.equal(locked.ledger.earned,0);
  }finally{await first.close();}
  shared.session={};const restarted=harness(shared);
  try{const state=(await restarted.invoke({target:'worker',type:'get'})).state;assert.equal(state.session.pausedAt!=null,true);assert.equal(state.session.effectiveMs>=59000,true);assert.equal(state.ledger.earned,0);}finally{await restarted.close();}
});

test('background grace alarm fails exactly at the persisted deadline',async()=>{
  const h=harness();
  try{
    await h.invoke({target:'worker',type:'website-settings',settings:{blockedHosts:['bad.test']}});
    await h.invoke({target:'worker',type:'start',kind:'focus'});
    await h.navigate('https://bad.test/');
    let state=(await h.invoke({target:'worker',type:'get'})).state;assert.equal(state.session.phase,'focus');assert.equal(state.session.siteWarning.host,'bad.test');
    const deadline=state.session.siteWarning.deadlineAt;assert.ok(h.alarms.has('site-grace'));h.setTime(deadline);await h.emit(h.chrome.alarms.onAlarm,{name:'site-grace'});
    state=(await h.invoke({target:'worker',type:'get'})).state;assert.equal(state.session.phase,'failed');assert.equal(state.session.siteWarning,null);
  }finally{await h.close();}
});

test('background safe leave clears grace and resumes accounting',async()=>{
  const h=harness();
  try{
    await h.invoke({target:'worker',type:'website-settings',settings:{blockedHosts:['bad.test']}});await h.invoke({target:'worker',type:'start',kind:'focus'});await h.navigate('https://bad.test/');
    let state=(await h.invoke({target:'worker',type:'get'})).state;const deadline=state.session.siteWarning.deadlineAt;h.advance(5000);await h.navigate('https://study.test/');state=(await h.invoke({target:'worker',type:'get'})).state;assert.equal(state.session.phase,'focus');assert.equal(state.session.siteWarning,null);assert.equal(state.session.accountedAt,Date.now());assert.ok(deadline>Date.now());
  }finally{await h.close();}
});

test('background switching between blocked sites keeps one grace deadline',async()=>{
  const h=harness();
  try{
    await h.invoke({target:'worker',type:'website-settings',settings:{blockedHosts:['bad.test','other.test']}});await h.invoke({target:'worker',type:'start',kind:'focus'});await h.navigate('https://bad.test/');
    let state=(await h.invoke({target:'worker',type:'get'})).state;const deadline=state.session.siteWarning.deadlineAt;h.advance(9000);await h.navigate('https://other.test/');state=(await h.invoke({target:'worker',type:'get'})).state;assert.equal(state.session.siteWarning.deadlineAt,deadline);
  }finally{await h.close();}
});

test('background finish-break requires the focus goal and starts one manual break',async()=>{
  const h=harness();
  try{
    await h.invoke({target:'worker',type:'timer-settings',settings:{focusMinutes:1,breakMinutes:5}});
    await h.invoke({target:'worker',type:'start',kind:'focus'});
    let reply=await h.invoke({target:'worker',type:'finish-break'});
    assert.equal(reply.ok,false);assert.match(reply.error,/goal|focus/i);
    let state=(await h.invoke({target:'worker',type:'get'})).state;
    assert.equal(state.session.phase,'focus');assert.equal(state.ledger.earned,0);assert.equal(state.restMs,0);

    h.advance(60000);
    reply=await h.invoke({target:'worker',type:'finish-break'});
    assert.equal(reply.ok,true);assert.equal(reply.state.session.kind,'break');assert.equal(reply.state.session.phase,'break');
    assert.equal(reply.state.ledger.earned,1);assert.equal(reply.state.restMs,0);
    const breakId=reply.state.session.id;
    reply=await h.invoke({target:'worker',type:'finish-break'});
    assert.equal(reply.ok,false);assert.match(reply.error,/focus|active/i);
    state=(await h.invoke({target:'worker',type:'get'})).state;assert.equal(state.session.id,breakId);assert.equal(state.ledger.earned,1);
  }finally{await h.close();}
});

test('background finish-break does not start a break after grace expiry',async()=>{
  const h=harness();
  try{
    await h.invoke({target:'worker',type:'website-settings',settings:{blockedHosts:['bad.test']}});
    await h.invoke({target:'worker',type:'timer-settings',settings:{focusMinutes:1,breakMinutes:5}});
    await h.invoke({target:'worker',type:'start',kind:'focus'});h.advance(60000);await h.invoke({target:'worker',type:'get'});
    await h.navigate('https://bad.test/');
    let state=(await h.invoke({target:'worker',type:'get'})).state;const deadline=state.session.siteWarning.deadlineAt;
    h.setTime(deadline);const reply=await h.invoke({target:'worker',type:'finish-break'});
    assert.equal(reply.ok,false);assert.match(reply.error,/failed|goal|focus/i);
    state=(await h.invoke({target:'worker',type:'get'})).state;assert.equal(state.session.phase,'failed');assert.equal(state.session.kind,'focus');
    assert.equal(state.restMs,300000);assert.equal(state.ledger.earned,1);
  }finally{await h.close();}
});

test('granted host permission injects a warning banner and popup reports access',async()=>{
  const h=harness({local:{},session:{}}, {permissions:['http://*.bad.test/*','https://*.bad.test/*']});
  try{
    await h.invoke({target:'worker',type:'website-settings',settings:{blockedHosts:['bad.test']}});
    await h.invoke({target:'worker',type:'start',kind:'focus'});
    await h.navigate('https://bad.test/');
    let state=(await h.invoke({target:'worker',type:'get'})).state;
    assert.equal(state.session.siteWarning.host,'bad.test');
    assert.equal(state.pageWarningAccess.granted,true);
    assert.ok(h.injections.length>=1);
    assert.equal(h.sentMessages.at(-1).message.warning.host,'bad.test');
    await h.activate('https://study.test/');
    const left=(await h.invoke({target:'worker',type:'get'})).state;
    for(let i=0;i<5;i++)await h.flush();
    assert.equal(left.session.siteWarning,null);
    assert.equal(h.sentMessages.some(entry=>entry.tabId===1&&entry.message.warning===null),true);
  }finally{await h.close();}
});

test('denied host permission does not inject, while grace expiry still fails the focus',async()=>{
  const h=harness({local:{},session:{}}, {permissions:[]});
  try{
    await h.invoke({target:'worker',type:'website-settings',settings:{blockedHosts:['bad.test']}});
    await h.invoke({target:'worker',type:'start',kind:'focus'});
    await h.navigate('https://bad.test/');
    let state=(await h.invoke({target:'worker',type:'get'})).state;
    assert.equal(state.pageWarningAccess.granted,false);
    assert.equal(h.injections.length,0);
    const deadline=state.session.siteWarning.deadlineAt;
    h.setTime(deadline);await h.emit(h.chrome.alarms.onAlarm,{name:'site-grace'});
    state=(await h.invoke({target:'worker',type:'get'})).state;
    assert.equal(state.session.phase,'failed');
  }finally{await h.close();}
});

test('warning injection rejection does not auto-pause focus or block worker requests',async()=>{
  const h=harness({local:{},session:{}}, {permissions:['http://*.bad.test/*','https://*.bad.test/*'],scriptingError:true,captureWarnings:true});
  try{
    await h.invoke({target:'worker',type:'website-settings',settings:{blockedHosts:['bad.test']}});
    await h.invoke({target:'worker',type:'start',kind:'focus'});
    await h.navigate('https://bad.test/');
    const reply=await h.invoke({target:'worker',type:'get'});
    assert.equal(reply.ok,true);
    assert.equal(reply.state.session.phase,'focus');
    assert.equal(reply.state.session.pausedAt,null);
    assert.ok(h.injections.length>=1);
    assert.equal(h.logs.length>=1,true);
  }finally{await h.close();}
});
