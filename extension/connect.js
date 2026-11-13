// Chrome closes the toolbar popup as soon as its USB chooser takes focus,
// so the first connection is made from this separate window instead.
const button=document.getElementById('choose'), status=document.getElementById('status');

function show(text,kind='') { status.textContent=text; status.dataset.state=kind; }
async function ask(type,extra={}) {
  const result=await chrome.runtime.sendMessage({target:'worker',type,...extra});
  if (!result?.ok) throw Error(result?.error||'Extension unavailable. Reload it on chrome://extensions.');
  return result.state;
}
function connected(state) {
  const mode=state?.hardware?.mode==='test'?'LED test mode':'dispenser ready';
  show(`Connected (${mode}). This window will close.`,'ok');
  button.disabled=true;
  setTimeout(()=>window.close(),2000);
}

button.addEventListener('click',async()=>{
  if (!navigator.serial) { show('Web Serial is unavailable. Use desktop Chrome or Edge.','error'); return; }
  let port;
  try { port=await navigator.serial.requestPort(); }
  catch (error) { show(error.name==='NotFoundError'?'No device chosen. Click the button to try again.':error.message,'error'); return; }
  button.disabled=true; show('Connecting… this takes about 2 seconds.');
  try { connected(await ask('connect-device',{portInfo:port.getInfo()})); }
  catch (error) { button.disabled=false; show(error.message,'error'); }
});

ask('get').then(state=>{ if (state?.hardware?.connected) connected(state); }).catch(()=>{});
