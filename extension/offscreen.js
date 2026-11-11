import {playCue} from './audio.js';
import {AttentionMonitor} from './attention.js';
// A real dedicated worker owns Web Serial; the popup only grants permission.
const serial=new Worker('serial-worker.js',{type:'module'});
let bridge=null,mode='',nextId=1;
const pending=new Map();
function connectBridge(){
  if(bridge)return;
  bridge=chrome.runtime.connect({name:'arduino'});
  bridge.onMessage.addListener(message=>{
    if(message.type==='command')request('command',message).then(value=>bridge?.postMessage({type:'reply',requestId:message.requestId,ok:true,value}),error=>bridge?.postMessage({type:'reply',requestId:message.requestId,ok:false,error:error.message}));
    if(message.type==='rejected'){mode='';request('disconnect').catch(console.warn);}
  });
  bridge.onDisconnect.addListener(()=>{bridge=null;});
  bridge.postMessage({type:'status',mode});
}
function publish(){try{connectBridge();bridge.postMessage({type:'status',mode});}catch{bridge=null;}}
function request(type,extra={}){
  const id=nextId++;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('USB worker timed out; any claim remains reserved.'));},30000);
    pending.set(id,{resolve,reject,timer});serial.postMessage({...extra,type,id});
  });
}
serial.onmessage=({data})=>{
  if(data.type==='status'){mode=data.mode||'';publish();return;}
  const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);
  data.ok?p.resolve(data.value):p.reject(new Error(data.error));
};
serial.onerror=()=>{mode='';publish();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('USB worker stopped.'));}pending.clear();};
// Eye-tracking monitor; created on first use. Frames never leave this document.
let attention=null;
function attentionMonitor(){
  attention??=new AttentionMonitor({
    onChange:present=>chrome.runtime.sendMessage({target:'worker',type:'attention',present}).catch(()=>{}),
    onStatus:status=>chrome.runtime.sendMessage({target:'worker',type:'attention-status',status}).catch(()=>{}),
  });
  return attention;
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return false;
  if(message?.target==='attention'){
    if(message.type==='start'){attentionMonitor().setBaseline(message.baseline??null);attentionMonitor().start();}
    else if(message.type==='stop')attentionMonitor().stop();
    else{respond({ok:false,error:'Unknown attention action.'});return false;}
    respond({ok:true});
    return false;
  }
  if(message?.target==='audio'){
    playCue(message.cue).then(value=>respond({ok:true,value}),error=>respond({ok:false,error:error.message}));return true;
  }
  if(message?.target!=='serial-host')return false;
  if(!['connect','disconnect','capabilities'].includes(message.type)){respond({ok:false,error:'Unknown USB action.'});return false;}
  request(message.type,{portInfo:message.portInfo}).then(value=>respond({ok:true,value}),error=>respond({ok:false,error:error.message}));return true;
});
setInterval(publish,2000);
publish();
