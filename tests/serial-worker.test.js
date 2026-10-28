import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {encodeFrame,decodeFrame,crc16} from '../extension/protocol.js';
const source=(await readFile(new URL('../extension/serial-worker.js',import.meta.url),'utf8')).replace("import {encodeFrame,decodeFrame} from './protocol.js';",'');
function harness({hello='READY_BANK_TEST',duplicate=false,claim='SIMULATED'}={}){
 const output=[],writes=[],frames=[];let readWaiter,readQueue=[],opened=0,id=0;
 const deliver=value=>{if(readWaiter){const done=readWaiter;readWaiter=null;done(value);}else readQueue.push(value);};
 const port={getInfo:()=>({usbVendorId:123,usbProductId:456}),open:async()=>{opened++;},close:async()=>{},
  readable:{getReader:()=>({read:()=>readQueue.length?Promise.resolve(readQueue.shift()):new Promise(resolve=>readWaiter=resolve),cancel:async()=>deliver({done:true}),releaseLock(){}})},
  writable:{getWriter:()=>({write:async bytes=>{const frame=new TextDecoder().decode(bytes);writes.push(frame);const f=frame.trim().split('|');frames.push(f);const body=`F1|${f[1]}|ACK|${f[3]}|${f[2]==='HELLO'?hello:claim}`;deliver({value:new TextEncoder().encode(`${body}|${crc16(body)}\n`),done:false});},releaseLock(){}})}};
 const timers=new Map();let timerId=0;
 const sandbox={encodeFrame,decodeFrame,TextEncoder,TextDecoder,console,self:{},postMessage:value=>output.push(value),navigator:{serial:{getPorts:async()=>duplicate?[port,port]:[port],addEventListener(){}}},setTimeout:(fn,ms)=>{const n=++timerId;if(ms===2000)queueMicrotask(fn);else timers.set(n,fn);return n;},clearTimeout:n=>timers.delete(n)};
 vm.runInNewContext(source,sandbox);
 const send=async(type,extra={})=>{const requestId=++id;await sandbox.self.onmessage({data:{type,id:requestId,...extra}});return output.find(x=>x.id===requestId);};
 return {send,frames,output,get opened(){return opened;}};
}
test('dedicated serial adapter reports feature support and BANK test handshake',async()=>{
 const h=harness();assert.deepEqual(JSON.parse(JSON.stringify((await h.send('capabilities')).value)),{serial:true,dedicatedWorker:true});
 const reply=await h.send('connect',{portInfo:{usbVendorId:123,usbProductId:456}});assert.equal(reply.ok,true);assert.equal(reply.value.mode,'test');
 const claimId='a'.repeat(32),result=await h.send('command',{command:'CLAIM',session:claimId,value:'1'});
 assert.equal(result.value,'SIMULATED');assert.equal(h.frames[1][2],'CLAIM');assert.equal(h.frames[1][3],claimId);assert.equal(h.frames.length,2);await h.send('disconnect');
});
test('legacy one-session firmware is refused without sending a CLAIM',async()=>{
 const h=harness({hello:'READY_TEST'}),reply=await h.send('connect',{portInfo:{usbVendorId:123,usbProductId:456}});
 assert.equal(reply.ok,false);assert.match(reply.error,/Old single-session firmware/);assert.equal(h.frames.length,1);
});
test('ambiguous granted devices are refused before opening any USB port',async()=>{
 const h=harness({duplicate:true}),reply=await h.send('connect',{portInfo:{usbVendorId:123,usbProductId:456}});
 assert.equal(reply.ok,false);assert.match(reply.error,/Multiple granted ports/);assert.equal(h.opened,0);
});
test('unexpected reward acknowledgement cannot count as successful delivery',async()=>{
 const h=harness({claim:'RUNNING'});await h.send('connect',{portInfo:{usbVendorId:123,usbProductId:456}});
 const reply=await h.send('command',{command:'CLAIM',session:'b'.repeat(32),value:'1'});
 assert.equal(reply.ok,false);assert.match(reply.error,/Unexpected/);await h.send('disconnect');
});
