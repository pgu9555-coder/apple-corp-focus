import {alertCue} from './audio.js';
import {Controller, LIVE, remaining, elapsed, isPaused, isWarning, isAway, needsDeviceLease, lcdFrame} from './core.js';
import {PageWarnings,warningAccess} from './page-warnings.js';
import {WarningWindow} from './warning-window.js';

let device=null;
let deviceMode='';
let deviceSeen=0;
let nextRequest=1;
const requests=new Map();
const activeTabs=new Map();
let focusedWindow=-1;
let offscreenCreation;
let graceTimer;
let warningNotificationId;
let awayTimer;
let awayNotificationId;
let attentionStatus='off', cameraOn=false;

async function focusedTab() {
  const windows=await chrome.windows.getAll({populate:true,windowTypes:['normal','popup']});
  const focused=windows.find(w=>w.focused);
  if(!focused)return {urls:[]};
  let tab=focused.tabs?.find(t=>t.active);
  const popupUrl=[tab?.pendingUrl,tab?.url].find(url=>warningWindow.isPage(url));
  if(popupUrl){
    // The warning itself must never count as leaving the blocked website.
    const source=new URL(popupUrl).searchParams.get('source');
    const previous=source===null?null:windows.find(w=>w.id===Number(source));
    tab=previous?.tabs?.find(t=>t.active);
  }
  return {urls:[tab?.pendingUrl,tab?.url].filter(Boolean)};
}
function hardware() { return {connected:Boolean(device && deviceMode && Date.now()-deviceSeen<10000),mode:deviceMode||'disconnected'}; }
function command(command,session,value) {
  if(!hardware().connected)return Promise.reject(new Error('Arduino is disconnected.'));
  const requestId=nextRequest++;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{requests.delete(requestId);reject(new Error('Arduino response timed out.'));},command==='CLAIM'?25000:6000);
    requests.set(requestId,{resolve,reject,timer});
    try { device.postMessage({type:'command',requestId,command,session,value}); }
    catch(error){clearTimeout(timer);requests.delete(requestId);reject(error);}
  });
}
// Mirror the popup timer on the dispenser's LCD. The Arduino counts down by
// itself between frames, so a frame is only sent on state changes, on the
// 30-second focus check, and when the device connects. Failures are ignored:
// the LCD is a display only and never affects timing or rewards.
let lcdLast='',lcdSentAt=0,lcdTrailing=null;
function syncLcd(state,force=false){
  if(!state||!hardware().connected)return;
  const frame=lcdFrame(state),now=Date.now();
  if(!force&&frame===lcdLast&&now-lcdSentAt<15000)return;
  if(!force&&now-lcdSentAt<1000){clearTimeout(lcdTrailing);lcdTrailing=setTimeout(()=>syncLcd(controller.snapshot(),true),1000-(now-lcdSentAt));lcdTrailing.unref?.();return;}
  clearTimeout(lcdTrailing);lcdLast=frame;lcdSentAt=now;
  command('SHOW','0',frame).catch(()=>{});
}
async function schedule(session) {
  clearTimeout(graceTimer);
  clearTimeout(awayTimer);
  if(isWarning(session)) {
    const deadline=session.siteWarning.deadlineAt;
    // The short timer is primary; persisted deadline + alarm survive worker loss.
    graceTimer=setTimeout(()=>event(()=>controller.tick()),Math.max(0,deadline-Date.now()));
    graceTimer.unref?.();
    await chrome.alarms.create('site-grace',{when:Math.max(Date.now()+1,deadline)});
  } else await chrome.alarms.clear('site-grace');
  if(isAway(session)) {
    const deadline=session.awayWarning.deadlineAt;
    awayTimer=setTimeout(()=>event(()=>controller.tick()),Math.max(0,deadline-Date.now()));
    awayTimer.unref?.();
    await chrome.alarms.create('attention-grace',{when:Math.max(Date.now()+1,deadline)});
  } else await chrome.alarms.clear('attention-grace');
  if(LIVE.has(session?.phase) || needsDeviceLease(session)) {
    await chrome.alarms.create('focus-check',{periodInMinutes:0.5});
    if(LIVE.has(session?.phase) && !isPaused(session) && !isWarning(session) && !isAway(session) && !(session.kind==='focus' && session.timerMode==='pomodoro' && session.goalReached)) {
      const target=session.kind==='focus'&&session.timerMode==='flow'?((session.rewardsAwarded||0)+1)*session.durationMs:session.durationMs;
      const next=session.accountedAt+Math.max(0,target-session.effectiveMs);
      await chrome.alarms.create('focus-end',{when:Math.max(Date.now()+1000,next)});
    } else await chrome.alarms.clear('focus-end');
  } else {
    await chrome.alarms.clear('focus-check'); await chrome.alarms.clear('focus-end');
  }
}
async function badge(state) {
  const s=state.session;
  const text=isWarning(s)||isAway(s)?'!':isPaused(s)?'II':LIVE.has(s?.phase)?String(s.kind==='focus'&&s.timerMode==='flow'?Math.floor(elapsed(s)/60):Math.max(1,Math.ceil(remaining(s)/60))):s?.delivery==='pending'?'✓':s?.phase==='failed'?'!':s?.phase==='fault'?'?':s?.phase==='completed'?'✓':'';
  await chrome.action.setBadgeText({text});
  await chrome.action.setBadgeBackgroundColor({color:isWarning(s)||isAway(s)?'#946500':['failed','fault'].includes(s?.phase)?'#B94534':'#235C51'});
  await chrome.action.setTitle({title:isWarning(s)?'Focus Machine · Leave blocked sites — open for countdown':isAway(s)?'Focus Machine · Look back at the screen':isPaused(s)?'Focus Machine · emergency pause':LIVE.has(s?.phase)?`Focus Machine · ${s.timerMode==='flow'&&s.kind==='focus'?'flow':s.phase}${s.rewardEarned?' · reward ready':''}`:'Focus Machine'});
}
async function ensureOffscreen() {
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]});
  if(!contexts.length) {
    if(!offscreenCreation)offscreenCreation=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['WORKERS','AUDIO_PLAYBACK','USER_MEDIA'],justification:'Host a dedicated Web Serial worker so the granted USB connection survives closing the popup, play requested timer alerts, and run the optional on-device eye-tracking camera during focus.'}).finally(()=>offscreenCreation=null);
    await offscreenCreation;
  }
}
// Camera policy: on only while a focus block is running with eye tracking enabled,
// including the away auto-pause (so looking back can resume). Serialized so a
// quick start/pause sequence cannot leave the camera in the wrong state.
function cameraWanted(s){return Boolean(s&&s.kind==='focus'&&s.phase==='focus'&&s.eyeTracking&&(!isPaused(s)||s.pauseKind==='away'));}
let cameraQueue=Promise.resolve();
function syncCamera(state,force=false){
  const run=cameraQueue.then(()=>syncCameraNow(state,force));
  cameraQueue=run.catch(()=>{});
  return run;
}
async function syncCameraNow(state,force) {
  const want=cameraWanted(state.session);
  if(want===cameraOn&&!force)return;
  if(want) {
    await ensureOffscreen();
    const {attentionBaseline}=await chrome.storage.local.get('attentionBaseline');
    await chrome.runtime.sendMessage({target:'attention',type:'start',baseline:attentionBaseline??null});
  } else {
    // Never create the offscreen document just to stop the camera.
    const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]});
    if(contexts.length)await chrome.runtime.sendMessage({target:'attention',type:'stop'});
  }
  cameraOn=want;
  if(!want)attentionStatus='off';
}
// A new calibration applies to a camera that is already running.
chrome.storage.onChanged?.addListener((changes,areaName)=>{
  if(areaName!=='local'||!changes.attentionBaseline||!cameraOn)return;
  chrome.runtime.sendMessage({target:'attention',type:'start',baseline:changes.attentionBaseline.newValue??null}).catch(console.warn);
});
async function sound(cue) {
  await ensureOffscreen();
  const reply=await chrome.runtime.sendMessage({target:'audio',type:'play',cue});
  if(!reply?.ok)throw new Error(reply?.error||'Chrome could not play the sound. Check your browser audio settings.');
  return reply.value;
}
async function alertUser(state) {
  const s=state.session;
  // Flow completion is user-controlled. A threshold or completed flow must
  // never play audio, open a notification, or steal focus with an alert window.
  if(s?.kind==='focus' && s.timerMode==='flow' && s.phase==='completed')return;
  const title=s.phase==='failed'?'Focus block ended':s.phase==='fault'?'Focus monitoring interrupted':s.kind==='break'?'Break finished':s.phase==='focus'?'Focus goal reached':'Focus block complete';
  const message=s.phase==='focus'?'Your goal is reached. Finish manually when you are ready.':s.phase==='completed'?(s.kind==='break'?'Start another block when you are ready.':'Focus recorded. Collect rewards manually from the popup.'):s.reason;
  await chrome.notifications.create(`focus-${s.id}`,{type:'basic',iconUrl:'assets/icon128.png',title,message,priority:2}).catch(console.warn);
  const cue=alertCue(state);if(cue)await sound(cue).catch(console.warn);
  // Notifications never open the dashboard or take focus away from the task.
}
const controller=new Controller({
  now:()=>Date.now(),uuid:()=>crypto.randomUUID(),active:focusedTab,hardware,command,schedule,
  save:state=>chrome.storage.local.set({state}),
  changed:state=>{syncLcd(state);warningWindow.refresh().catch(console.warn);badge(state).catch(console.warn);if(!isWarning(state.session)){const id=warningNotificationId||(state.session?.id?`site-warning-${state.session.id}`:null);if(id)chrome.notifications.clear?.(id)?.catch(console.warn);warningNotificationId=null;}if(!isAway(state.session)){const id=awayNotificationId||(state.session?.id?`away-warning-${state.session.id}`:null);if(id)chrome.notifications.clear?.(id)?.catch(console.warn);awayNotificationId=null;}syncCamera(state).catch(console.warn);},
  warning:state=>{const s=state.session;warningNotificationId=`site-warning-${s.id}`;chrome.notifications.create(warningNotificationId,{type:'basic',iconUrl:'assets/icon128.png',title:'Leave the blocked website',message:`Leave ${s.siteWarning.host} within 10 seconds to keep this focus session. Focus time is frozen.`,priority:2,requireInteraction:true}).catch(console.warn);},
  awayWarning:state=>{const s=state.session;awayNotificationId=`away-warning-${s.id}`;chrome.notifications.create(awayNotificationId,{type:'basic',iconUrl:'assets/icon128.png',title:'Look back at the screen',message:'Focus time is frozen. Look back within 10 seconds or this session pauses.',priority:2}).catch(console.warn);},
  alert:state=>{alertUser(state).catch(console.error);},
});
const warningWindow=new WarningWindow(chrome,()=>controller.state.session);
const pageWarnings=new PageWarnings(chrome,()=>controller.snapshot());
const ready=(async()=>{
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const [saved,epoch,windows]=await Promise.all([
    chrome.storage.local.get(['state','eyeTrackingDefaultApplied']),chrome.storage.session.get('browserSession'),chrome.windows.getAll({populate:true}),
  ]);
  for(const w of windows){const t=w.tabs?.find(t=>t.active);if(t)activeTabs.set(w.id,t.id);if(w.focused)focusedWindow=w.id;}
  await chrome.storage.session.set({browserSession:true});
  const applyCameraDefault=!saved.eyeTrackingDefaultApplied;
  if(applyCameraDefault&&saved.state){
    saved.state.settings={...saved.state.settings,eyeTracking:true};
  }
  await controller.load(saved.state,Boolean(epoch.browserSession));
  if(applyCameraDefault){
    await chrome.storage.local.set({state:controller.state,eyeTrackingDefaultApplied:true});
  }
  await badge(controller.snapshot());
  await syncCamera(controller.snapshot()).catch(console.warn);
})();
function run(fn) { return ready.then(()=>controller.run(async()=>{
  try { return await fn(); }
  finally { pageWarnings.refresh().catch(console.warn); }
})); }
function event(fn) { run(fn).catch(error=>{
  if(error?.code==='BROWSER_ACTIVITY_CHANGED'){
    // Normal tab/window churn is retried, not converted into an emergency pause.
    setTimeout(()=>event(()=>controller.tick()),250);
    return;
  }
  console.error(error);
  chrome.storage.local.set({lastMonitoringError:{at:Date.now(),name:error?.name||'Error',message:String(error?.message||error).slice(0,500)}}).catch(console.warn);
  run(()=>controller.autoPause('Monitoring paused after an error. Resume manually when ready.')).catch(console.error);
}); }

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.target!=='worker')return false;
  const trusted=sender.id===chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
  if(!trusted){respond({ok:false,error:'Untrusted request.'});return false;}
  run(async()=>{
    switch(message.type) {
      case 'get': {
        const s=controller.state.session;
        if(LIVE.has(s?.phase)&&!isPaused(s)&&Date.now()-(s.accountedAt??s.lastCheckAt??Date.now())>=1000)await controller.tick();
        const snapshot=controller.snapshot();
        snapshot.attentionStatus=attentionStatus;
        snapshot.activeBlocked=controller.findBlocked(await focusedTab(),snapshot.settings.blockedHosts);
        snapshot.pageWarningAccess=await warningAccess(chrome,snapshot.settings.blockedHosts);
        snapshot.notificationPermission=await chrome.notifications.getPermissionLevel?.().catch(()=> 'unknown')||'unknown';
        return snapshot;
      }
      case 'start': {
        if(message.settings!==undefined) {
          if(message.kind!==undefined&&!['focus','break'].includes(message.kind))throw new Error('Unknown timer type.');
          await controller.settings(message.settings,'timer');
        }
        return controller.start(message.kind);
      }
      case 'cancel': return controller.cancel(message.confirmed);
      case 'pause': return controller.pause(message.confirmed);
      case 'resume': return controller.resume();
      case 'finish': return controller.finish();
      case 'finish-break': return controller.finishAndBreak();
      case 'prepare-focus': return controller.prepareFocus();
      case 'collect': return controller.collect();
      case 'connect-device': {
        await ensureOffscreen();
        const result=await chrome.runtime.sendMessage({target:'serial-host',type:'connect',portInfo:message.portInfo});
        if(!result?.ok)throw new Error(result?.error||'The USB worker did not respond.');
        return controller.snapshot();
      }
      case 'disconnect-device': {
        const result=await chrome.runtime.sendMessage({target:'serial-host',type:'disconnect'});
        if(!result?.ok)throw new Error(result?.error||'The USB worker did not respond.');
        return controller.snapshot();
      }
      case 'settings': return controller.settings(message.settings);
      case 'timer-settings': return controller.settings(message.settings,'timer');
      case 'website-settings': return controller.settings(message.settings,'websites');
      case 'save-preset': return controller.savePreset(message.preset);
      case 'delete-preset': return controller.deletePreset(message.id);
      case 'open-dashboard': {
        const section=message.section||'websites';
        if(section!=='websites')throw new Error('USB connection is managed in the popup.');
        const base=chrome.runtime.getURL('dashboard.html');
        const url=`${base}#website-rules`;
        const tabs=await chrome.tabs.query({});
        const existing=tabs.find(tab=>tab.url?.split('#')[0]===base);
        if(existing){await chrome.tabs.update(existing.id,{url,active:true});await chrome.windows.update(existing.windowId,{focused:true});}
        else await chrome.tabs.create({url});
        return controller.snapshot();
      }
      case 'attention': {
        if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw new Error('Untrusted attention source.');
        await controller.attention(Boolean(message.present));
        return {ok:true};
      }
      case 'attention-status': {
        if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw new Error('Untrusted attention source.');
        if(!['starting','watching','denied','no-camera','error','off'].includes(message.status))throw new Error('Unknown camera status.');
        attentionStatus=message.status;
        if(['error','denied','no-camera'].includes(message.status)&&cameraWanted(controller.state.session)){
          await controller.autoPause('Camera monitoring stopped. Open Set up camera to fix access, then resume manually.','camera');
        }
        return {ok:true};
      }
      case 'open-camera-setup': {
        const url=chrome.runtime.getURL('camera.html');
        const tabs=await chrome.tabs.query({});
        const existing=tabs.find(tab=>tab.url?.split('#')[0]===url);
        if(existing){await chrome.tabs.update(existing.id,{active:true});await chrome.windows.update(existing.windowId,{focused:true});}
        else await chrome.tabs.create({url});
        return controller.snapshot();
      }
      case 'test-alert':
        if(LIVE.has(controller.state.session?.phase))throw new Error('Test the sound before starting a block.');
        if(!['success','failure'].includes(message.cue))throw new Error('Choose a success or failure preview.');
        return {...controller.snapshot(),audio:await sound(message.cue)};
      default:throw new Error('Unknown action.');
    }
  }).then(state=>respond({ok:true,state}),error=>respond({ok:false,error:error.message}));
  return true;
});

// Only the extension's offscreen host may own the USB bridge.
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=='arduino' || port.sender?.id!==chrome.runtime.id || port.sender?.url!==chrome.runtime.getURL('offscreen.html'))return;
  if(device){port.postMessage({type:'rejected',error:'A USB connection host already exists.'});port.disconnect();return;}
  device=port;deviceMode='';deviceSeen=Date.now();
  port.onMessage.addListener(message=>{
    if(device!==port)return;
    if(message.type==='status') {
      deviceMode=['test','live'].includes(message.mode)?message.mode:'';deviceSeen=Date.now();
      event(async()=>{
        await controller.tick();
        syncLcd(controller.snapshot(),true);
      });
    } else if(message.type==='reply') {
      const p=requests.get(message.requestId);
      if(!p)return;
      clearTimeout(p.timer);requests.delete(message.requestId);
      message.ok?p.resolve(message.value):p.reject(new Error(String(message.error||'Arduino error')));
    }
  });
  port.onDisconnect.addListener(()=>{
    if(device!==port)return;
    device=null;deviceMode='';deviceSeen=0;
    for(const p of requests.values()){clearTimeout(p.timer);p.reject(new Error('The USB connection host closed.'));}requests.clear();
  });
});

function navigation(details) {
  if(details.frameId!==0||warningWindow.isPage(details.url))return;
  controller.revision++;
  // Capture attention at event arrival, before later tab switches can overwrite it.
  const wasActive=activeTabs.get(focusedWindow)===details.tabId;
  // Window-focus callbacks can lag when an alert window closes. Query attention
  // immediately as well, rather than relying exclusively on the cached window ID.
  const attention=chrome.tabs.get(details.tabId).then(async tab=>({active:tab.active,focused:(await chrome.windows.get(tab.windowId)).focused})).catch(()=>null);
  event(async()=>{const current=await attention;if(wasActive||(current?.active&&current.focused))await controller.visit(details.url);});
}
chrome.webNavigation.onBeforeNavigate.addListener(navigation);
chrome.webNavigation.onCommitted.addListener(details=>{if(details.frameId===0)pageWarnings.invalidate(details.tabId);navigation(details);});
chrome.webNavigation.onHistoryStateUpdated.addListener(navigation);
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.url)navigation({tabId,frameId:0,url:change.url});if(change.status==='complete'){pageWarnings.invalidate(tabId);event(()=>controller.tick());}});
chrome.tabs.onActivated.addListener(info=>{
  controller.revision++;
  activeTabs.set(info.windowId,info.tabId);
  const wasFocused=info.windowId===focusedWindow;
  const snapshot=Promise.all([chrome.tabs.get(info.tabId),chrome.windows.get(info.windowId)]).catch(()=>[null,null]);
  event(async()=>{
    const [tab,win]=await snapshot;
    if((wasFocused||win?.focused)&&tab&&!warningWindow.isPage(tab.pendingUrl)&&!warningWindow.isPage(tab.url))await controller.visit(tab.pendingUrl||tab.url||'');
  });
});
chrome.windows.onFocusChanged.addListener(windowId=>{
  controller.revision++;focusedWindow=windowId;
  if(windowId===chrome.windows.WINDOW_ID_NONE){event(()=>controller.tick());return;}
  const snapshot=chrome.tabs.query({windowId,active:true}).catch(()=>[]);
  event(async()=>{
    const [tab]=await snapshot;
    if(tab){activeTabs.set(windowId,tab.id);if(!warningWindow.isPage(tab.pendingUrl)&&!warningWindow.isPage(tab.url))await controller.visit(tab.pendingUrl||tab.url||'');}
  });
});
chrome.tabs.onReplaced.addListener((added,removed)=>{
  controller.revision++;
  for(const [w,t] of activeTabs)if(t===removed)activeTabs.set(w,added);
  event(()=>controller.tick());
});
chrome.windows.onRemoved.addListener(id=>{
  activeTabs.delete(id);controller.revision++;
  event(async()=>{if(!(await chrome.windows.getAll({windowTypes:['normal']})).length && !isPaused(controller.state.session))await controller.autoPause('Chrome windows were closed. Your progress is saved. Resume manually when ready.');});
});
chrome.tabs.onRemoved?.addListener(()=>event(()=>controller.tick()));
chrome.alarms.onAlarm.addListener(alarm=>{
  if(['focus-check','focus-end','site-grace','attention-grace'].includes(alarm.name))event(async()=>{await controller.tick();syncLcd(controller.snapshot(),alarm.name==='focus-check');});
  // Re-arm the camera if Chrome closed the offscreen document during focus.
  if(alarm.name==='focus-check')ready.then(()=>{const snapshot=controller.snapshot();if(cameraWanted(snapshot.session))return syncCamera(snapshot,true);}).catch(console.warn);
});
chrome.idle.onStateChanged.addListener(state=>{if(state==='locked'){controller.revision++;event(()=>controller.autoPause('The computer was locked. Your progress is saved. Resume manually when ready.'));}});
chrome.runtime.onStartup.addListener(()=>event(()=>controller.autoPause('Chrome restarted. Your progress is saved. Resume manually when ready.')));
chrome.notifications.onClicked.addListener(()=>chrome.action.openPopup().catch(console.warn));
chrome.permissions?.onAdded?.addListener(()=>pageWarnings.refresh().catch(console.warn));
chrome.permissions?.onRemoved?.addListener(()=>pageWarnings.refresh().catch(console.warn));

// Restore cleared alarms on service-worker wake. A normal worker suspension does not reset the timer.
ready.then(()=>run(()=>controller.tick())).catch(console.error);
