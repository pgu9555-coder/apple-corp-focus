import test from 'node:test';
import assert from 'node:assert/strict';
import {PageWarnings,warningAccess,warningOrigins} from '../extension/page-warnings.js';

function fixture(){
  const sent=[],injected=[];let granted=true;
  const state={session:{id:'run',phase:'focus',pausedAt:null,blockedHosts:['bad.test'],siteWarning:{host:'bad.test',deadlineAt:Date.now()+10000}}};
  const tab={id:7,windowId:1,active:true,url:'https://bad.test/watch'},win={id:1,focused:true,tabs:[tab]};
  const api={permissions:{contains:async()=>granted},windows:{getAll:async()=>[win],get:async()=>win},tabs:{get:async()=>tab,sendMessage:async(id,message)=>sent.push({id,message})},scripting:{executeScript:async v=>injected.push(v)}};
  return {state,tab,win,api,sent,injected,adapter:new PageWarnings(api,()=>structuredClone(state)),grant:v=>granted=v};
}
test('banner permission patterns cover configured sites only',()=>{
  assert.deepEqual(warningOrigins(['bad.test','bad.test','127.0.0.1']),['http://*.bad.test/*','https://*.bad.test/*','http://127.0.0.1/*','https://127.0.0.1/*']);
});
test('no host permission means no injection, no timer mutation',async()=>{
  const f=fixture();f.grant(false);const before=structuredClone(f.state);await f.adapter.refresh();assert.equal(f.injected.length,0);assert.deepEqual(f.state,before);
  assert.equal((await warningAccess(f.api,['bad.test'])).granted,false);
});
test('one banner per warning document; sends no private bank or settings',async()=>{
  const f=fixture();await f.adapter.refresh();await f.adapter.refresh();assert.equal(f.injected.length,1);assert.deepEqual(Object.keys(f.sent[0].message.warning).sort(),['deadlineAt','host','sessionId']);
});
test('leaving, pausing or expiry clears displayed banner',async()=>{
  for(const change of [f=>f.tab.url='https://study.test',f=>f.state.session.pausedAt=1,f=>f.state.session.phase='failed']){
    const f=fixture();await f.adapter.refresh();change(f);await f.adapter.refresh();assert.equal(f.sent.at(-1).message.warning,null);
  }
});
test('permission revocation clears banner; regrant allows redisplay',async()=>{
  const f=fixture();await f.adapter.refresh();f.grant(false);await f.adapter.refresh();assert.equal(f.sent.at(-1).message.warning,null);f.grant(true);await f.adapter.refresh();assert.equal(f.injected.length,2);
});
test('in-flight injection cannot show an expired or ended session',async()=>{
  const f=fixture();f.api.scripting.executeScript=async()=>{f.state.session.phase='failed';};await f.adapter.refresh();assert.equal(f.sent.at(-1).message.warning,null);
});
test('navigation invalidation reinjects on a new document',async()=>{
  const f=fixture();await f.adapter.refresh();f.adapter.invalidate(7);await f.adapter.refresh();assert.equal(f.injected.length,2);
});
