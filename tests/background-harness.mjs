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
  const chrome={runtime,permissions,windows:{WINDOW_ID_NONE:-1,onFocusChanged:new Event(),onRemoved:new Event(),getAll:async()=>structuredClone(windows),get:async id=>windows.find(w=>w.id===id),update:async()=>{}},tabs:{onUpdated:new Event(),onActivated:new Event(),onReplaced:new Event(),get:async id=>windows.flatMap(w=>w.tabs).find(t=>t.id===id),query:async()=>windows.flatMap(w=>w.tabs).filter(t=>t.active),sendMessage:async(tabId,message)=>{sentMessages.push({tabId,message});},create:async()=>{},update:async()=>{}},webNavigation:{onBeforeNavigate:new Event(),onCommitted:new Event(),onHistoryStateUpdated:new Event()},alarms:{onAlarm:new Event(),create:async(name,opt)=>alarms.set(name,opt),clear:async name=>alarms.delete(name)},idle:{onStateChanged:new Event()},notifications:{onClicked:new Event(),create:async()=>'',getAll:async()=>({})},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{},openPopup:async()=>{}},offscreen:{createDocument:async()=>{},closeDocument:async()=>{}},storage:{local:{setAccessLevel:async()=>{},get:async key=>Object.fromEntries((Array.isArray(key)?key:[key]).map(k=>[k,backing.local[k]])),set:async value=>Object.assign(backing.local,value)},session:{get:async key=>({browserSession:backing.session.browserSession}),set:async value=>Object.assign(backing.session,value)}},scripting};
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


export {harness};
