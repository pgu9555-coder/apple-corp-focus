import {encodeFrame,decodeFrame} from './protocol.js';
let port=null,reader=null,writer=null,mode='',sequence=1,closing=false,connecting=false;
const pending=new Map();
let writeTail=Promise.resolve();
const publish=()=>postMessage({type:'status',mode});
function request(command,session='0',value='0'){
  if(!writer)return Promise.reject(new Error('USB is disconnected.'));
  const destination=writer,seq=sequence++;if(sequence>2147483647)sequence=1;
  const frame=encodeFrame(seq,command,session,value);
  const result=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(seq);reject(new Error(`${command} acknowledgement timed out.`));},command==='CLAIM'?20000:4000);
    pending.set(seq,{resolve,reject,timer,session,command});
  });
  result.catch(()=>{});
  writeTail=writeTail.catch(()=>{}).then(()=>{
    if(!pending.has(seq)||writer!==destination)throw new Error('The USB connection changed before writing.');
    return destination.write(new TextEncoder().encode(frame));
  }).catch(error=>{const p=pending.get(seq);if(p){clearTimeout(p.timer);pending.delete(seq);p.reject(error);}});
  return result;
}
function accept(line){
  let reply;try{reply=decodeFrame(line);}catch{return;}
  const p=pending.get(reply.sequence);if(!p||p.session!==reply.session)return;
  clearTimeout(p.timer);pending.delete(reply.sequence);
  if(reply.type==='ERR'){p.reject(new Error(`Device: ${reply.value}`));return;}
  const expected={HELLO:['READY_BANK_TEST','READY_BANK','READY_TEST','READY'],CLAIM:['SIMULATED','DISPENSED']};
  if(!expected[p.command]?.includes(reply.value)){p.reject(new Error('Unexpected device acknowledgement.'));return;}
  p.resolve(reply.value);
}
async function readLoop(localReader){
  let buffer='';const decoder=new TextDecoder();
  try{while(reader===localReader){
    const {value,done}=await localReader.read();if(done)break;
    buffer+=decoder.decode(value,{stream:true});let end;
    while((end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);if(line)accept(line);}
    if(buffer.length>512)buffer='';
  }}catch{}finally{
    try{localReader.releaseLock();}catch{}
    if(reader===localReader)reader=null;
    if(!closing)await disconnect();
  }
}
async function disconnect(){
  if(closing)return;closing=true;mode='';publish();
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('USB disconnected; pending claims cannot be retried.'));}pending.clear();
  try{await reader?.cancel();}catch{}
  try{writer?.releaseLock();}catch{}writer=null;
  try{await port?.close();}catch{}port=null;reader=null;closing=false;connecting=false;
}
async function connect(info){
  if(connecting||port)throw new Error('A USB connection is already open or connecting.');
  if(!navigator.serial)throw new Error('Web Serial is unavailable in this Chrome worker.');
  if(!info||typeof info!=='object')throw new Error('Choose a USB port from the popup first.');
  connecting=true;
  try{
    const granted=await navigator.serial.getPorts();
    const matches=granted.filter(p=>{const candidate=p.getInfo();return candidate.usbVendorId===info.usbVendorId&&candidate.usbProductId===info.usbProductId;});
    if(matches.length!==1)throw new Error(matches.length?'Multiple granted ports match this device. Disconnect extra matching devices and reconnect.':'No matching permitted USB port. Choose the device again.');
    port=matches[0];await port.open({baudRate:115200,bufferSize:1024});
    reader=port.readable.getReader();writer=port.writable.getWriter();readLoop(reader);
    await new Promise(resolve=>setTimeout(resolve,2000));
    const hello=await request('HELLO');
    if(!['READY_BANK_TEST','READY_BANK'].includes(hello))throw new Error('Old single-session firmware is incompatible. Upload the included FocusMachineBankTest sketch (LED only), or compatible BANK firmware.');
    mode=hello==='READY_BANK_TEST'?'test':'live';connecting=false;publish();return {mode};
  }catch(error){await disconnect();throw error;}
}
self.onmessage=async({data})=>{
  try{
    let value;
    if(data.type==='capabilities')value={serial:Boolean(navigator.serial),dedicatedWorker:true};
    else if(data.type==='connect')value=await connect(data.portInfo);
    else if(data.type==='disconnect'){await disconnect();value=true;}
    else if(data.type==='command'){
      if(data.command!=='CLAIM'||!mode)throw new Error('Unsupported or disconnected reward command.');
      value=await request('CLAIM',data.session,data.value);
    }else throw new Error('Unknown USB worker action.');
    postMessage({id:data.id,ok:true,value});
  }catch(error){postMessage({id:data.id,ok:false,error:error.message});}
};
navigator.serial?.addEventListener('disconnect',event=>{if(event.target===port||event.port===port)disconnect();});
