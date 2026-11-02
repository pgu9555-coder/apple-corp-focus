(() => {
  // Isolated-world singleton: repeated navigation must not create duplicate banners.
  if(globalThis.__appleFocusWarning)return;
  globalThis.__appleFocusWarning=true;
  let hostElement=null,timer=null,warning=null,heading=null,detail=null;
  function clear(){clearInterval(timer);timer=null;warning=null;hostElement?.remove();hostElement=null;}
  function draw(){
    if(!warning)return;
    if(document.visibilityState==='hidden'){clear();return;}
    const seconds=Math.max(0,Math.ceil((warning.deadlineAt-Date.now())/1000));
    heading.textContent=seconds?`Leave this site within 00:${String(seconds).padStart(2,'0')}`:'Grace time ended';
    detail.textContent=seconds?'Focus time is frozen. Switch to a permitted site to continue.':'Open Apple Corp Focus Machine to check your session.';
    // This banner is a display, not the authoritative timer or a failure verdict.
    if(Date.now()>warning.deadlineAt+5000)clear();
  }
  function show(value){
    clear();
    if(!value||typeof value.sessionId!=='string'||!Number.isFinite(value.deadlineAt)||value.deadlineAt<=Date.now()||value.deadlineAt>Date.now()+11000||document.visibilityState==='hidden')return;
    warning=value;hostElement=document.createElement('div');
    hostElement.style.cssText='all:initial!important;position:fixed!important;top:12px!important;left:12px!important;right:12px!important;z-index:2147483647!important;pointer-events:none!important;';
    const shadow=hostElement.attachShadow({mode:'closed'}),box=document.createElement('div');
    box.style.cssText='box-sizing:border-box;max-width:580px;margin:0 auto;padding:14px 18px;border:2px solid #c69728;border-radius:12px;background:#fff2ce;color:#533d08;font:14px/1.45 Arial,sans-serif;box-shadow:0 4px 20px #0003;';
    const brand=document.createElement('div');brand.textContent='Apple Corp · Focus warning';brand.style.cssText='font-size:12px;margin-bottom:3px;';
    heading=document.createElement('strong');heading.style.cssText='display:block;font-size:20px;';
    heading.setAttribute('role','timer');heading.setAttribute('aria-live','off');
    detail=document.createElement('div');detail.setAttribute('role','status');
    box.append(brand,heading,detail);shadow.append(box);document.documentElement.append(hostElement);
    draw();timer=setInterval(draw,250);
  }
  chrome.runtime.onMessage.addListener((message,sender)=>{
    if(sender.id!==chrome.runtime.id||message?.type!=='apple-focus-warning')return;
    message.warning?show(message.warning):clear();
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')clear();});
  addEventListener('pagehide',clear);
})();
