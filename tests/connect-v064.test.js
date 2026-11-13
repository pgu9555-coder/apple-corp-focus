import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as core from '../extension/core.js';
import {warningOrigins} from '../extension/page-warnings.js';

function element(id='') {
  const listeners={};
  return {id,hidden:false,disabled:false,value:'',checked:false,textContent:'',title:'',dataset:{},style:{},children:[],classList:{contains:()=>false,add(){},toggle(){}},
    addEventListener:(type,fn)=>{(listeners[type]??=[]).push(fn);},fire(type,event={}){return Promise.all((listeners[type]||[]).map(fn=>fn(event)));},
    append(...n){this.children.push(...n);},appendChild(n){this.children.push(n);},replaceChildren(...n){this.children=[...n];},setAttribute(){},showModal(){}};
}

// Loads the real popup script with fake Chrome, Web Serial and window objects.
function harness({granted=[],inTab=false,connectFails=false}={}) {
  const elements=new Map(), messages=[], calls={requestPort:0,closed:0};
  const body=element('body'); body.classList={contains:x=>x==='popup',add(){},toggle(){}};
  const document={body,head:element('head'),getElementById(id){if(!elements.has(id))elements.set(id,element(id));return elements.get(id);},createElement:tag=>element(tag),querySelectorAll:()=>[]};
  const state={schema:5,settings:{focusMinutes:25,breakMinutes:5,timerMode:'flow',sound:true,requireArduino:false,blockedHosts:[]},presets:[],session:null,stats:{completed:0},restMs:0,ledger:{earned:0,claims:[]},history:[],ui:{view:'ready'},hardware:{connected:false}};
  const chrome={
    runtime:{sendMessage:async msg=>{messages.push(msg);
      if(msg.type==='connect-device'){if(connectFails)return {ok:false,error:'Device did not answer.'};state.hardware={connected:true,mode:'test'};}
      return {ok:true,state:structuredClone(state)};}},
    tabs:{getCurrent:async()=>inTab?{id:7}:undefined},
    storage:{onChanged:{addListener(){}}},
  };
  const navigator={serial:{getPorts:async()=>granted,requestPort:async()=>{calls.requestPort++;return {getInfo:()=>({usbVendorId:9025,usbProductId:67})};}}};
  const window={close:()=>{calls.closed++;}};
  const context={document,chrome,navigator,window,console,Date,URL,structuredClone,Set,Math,Number,JSON,Promise,Error,setInterval(){},clearInterval,setTimeout,clearTimeout,
    LIVE:core.LIVE,remaining:core.remaining,elapsed:core.elapsed,formatTime:core.formatTime,isPaused:core.isPaused,isWarning:core.isWarning,isAway:core.isAway,awayRemaining:core.awayRemaining,warningRemaining:core.warningRemaining,warningOrigins,
    settingsFrom:o=>({...o,focusMinutes:Number(o.focusMinutes),breakMinutes:Number(o.breakMinutes)}),rewardSummary:()=>({available:0,unconfirmed:0,confirmed:0})};
  const source=fs.readFileSync(new URL('../extension/ui.js',import.meta.url),'utf8')
    .replace(/^import[^\n]+\n/gm,'').replace(/^if \(document\.body\?\.classList[\s\S]*?\n\}\n/,'').replace('export async function ask','async function ask');
  vm.runInNewContext(source,context,{filename:'ui.js'});
  const click=()=>elements.get('usb-settings').fire('click',{});
  return {messages,calls,click,error:()=>elements.get('error')};
}
const settle=()=>new Promise(r=>setTimeout(r,20));
const types=h=>h.messages.map(m=>m.type).filter(t=>t!=='get');

test('a previously chosen device reconnects from the popup with no chooser',async()=>{
  const h=harness({granted:[{getInfo:()=>({usbVendorId:9025,usbProductId:67})}]});await settle();
  await h.click();
  assert.deepEqual(types(h),['connect-device']);
  assert.deepEqual(h.messages.find(m=>m.type==='connect-device').portInfo,{usbVendorId:9025,usbProductId:67});
  assert.equal(h.calls.requestPort,0);assert.equal(h.calls.closed,0);
});

test('first connection from the toolbar popup opens the connect window instead of the chooser',async()=>{
  const h=harness();await settle();
  await h.click();
  assert.deepEqual(types(h),['open-connect']);
  assert.equal(h.calls.requestPort,0);assert.equal(h.calls.closed,1);
});

test('the popup page opened in a tab still uses the chooser directly',async()=>{
  const h=harness({inTab:true});await settle();
  await h.click();
  assert.equal(h.calls.requestPort,1);
  assert.deepEqual(types(h),['connect-device']);
});

test('a failed direct reconnect explains itself and the next click opens the connect window',async()=>{
  const h=harness({granted:[{getInfo:()=>({usbVendorId:1,usbProductId:2})}],connectFails:true});await settle();
  await h.click();
  assert.match(h.error().textContent,/Device did not answer\..*Click Connect device again/);
  await h.click();
  assert.deepEqual(types(h),['connect-device','open-connect']);
});

test('connect page and background action exist',()=>{
  const html=fs.readFileSync(new URL('../extension/connect.html',import.meta.url),'utf8');
  assert.match(html,/id="choose"/);assert.match(html,/src="connect.js"/);
  const bg=fs.readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');
  assert.match(bg,/case 'open-connect'[\s\S]*?getURL\('connect\.html'\)[\s\S]*?chrome\.windows\.create/);
});
