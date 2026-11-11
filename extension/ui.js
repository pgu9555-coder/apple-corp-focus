import {LIVE,remaining,elapsed,formatTime,isPaused,isWarning,isAway,awayRemaining,warningRemaining,rewardSummary,settingsFrom} from './core.js';
import {warningOrigins} from './page-warnings.js';

if (document.body?.classList.contains('popup')) {
  const style=document.createElement('link'); style.rel='stylesheet'; style.href='v050-overrides.css'; document.head.append(style);
}
const $=id=>document.getElementById(id), popup=Boolean($('timer'));
let state=null, timerSignature='', websiteSignature='', presetSignature='', usbBusy=false, pageWarningStatus='', pageWarningStatusKey='';
let saveTimer=null, saveVersion=0, draftDirty=false, pendingSave=null;

export async function ask(type,extra={}) {
  const result=await chrome.runtime.sendMessage({target:'worker',type,...extra});
  if (!result?.ok) throw Error(result?.error||'Extension unavailable. Reopen the popup.');
  return result.state;
}
function showError(message='') { if ($('error')) { $('error').textContent=message; $('error').hidden=!message; } }
function timerValues() {
  return {focusMinutes:$('focus-minutes').value,breakMinutes:$('break-minutes').value,timerMode:$('timer-mode').value};
}
function validForm() {
  try { return settingsFrom({...state?.settings,...timerValues()}); } catch { return null; }
}
function timerSettings() {
  const f=validForm();
  return f ? {focusMinutes:f.focusMinutes,breakMinutes:f.breakMinutes,timerMode:f.timerMode} : null;
}
const presetLabel=p=>`${p.focusMinutes} / ${p.breakMinutes} min`;

function renderPresets(settings) {
  const row=$('preset-row'); if (!row) return;
  const presets=state?.presets||[];
  const signature=JSON.stringify({presets,focusMinutes:Number(settings?.focusMinutes),breakMinutes:Number(settings?.breakMinutes)});
  if (signature===presetSignature && row.children.length) return;
  presetSignature=signature;
  row.replaceChildren();
  for (const preset of presets) {
    const wrap=document.createElement('div'); wrap.className='preset-chip-wrap';
    const use=document.createElement('button'); use.type='button'; use.className='chip';
    use.textContent=presetLabel(preset); use.setAttribute('aria-label',`Use ${presetLabel(preset)} preset`);
    if (Number(settings?.focusMinutes)===preset.focusMinutes && Number(settings?.breakMinutes)===preset.breakMinutes) use.classList.add('active');
    use.addEventListener('click',()=>{ if (LIVE.has(state?.session?.phase)) return; $('focus-minutes').value=preset.focusMinutes; $('break-minutes').value=preset.breakMinutes; markDraft(); queueSettingsSave(); });
    const remove=document.createElement('button'); remove.type='button'; remove.className='preset-delete'; remove.textContent='×';
    remove.title=`Delete ${presetLabel(preset)} preset`; remove.setAttribute('aria-label',`Delete ${presetLabel(preset)} preset`);
    remove.addEventListener('click',event=>{event.stopPropagation(); action('delete-preset',{id:preset.id});});
    wrap.append(use,remove); row.append(wrap);
  }
  const custom=document.createElement('button'); custom.type='button'; custom.className='chip custom-chip'; custom.textContent='Custom';
  custom.addEventListener('click',()=>{$('focus-minutes').focus();$('focus-minutes').select();}); row.append(custom);
}
function preview() {
  if (!popup) return;
  const settings=validForm(), live=LIVE.has(state?.session?.phase);
  $('start').disabled=!settings||Boolean(state?.activeBlocked)||live;
  if (!live && (!state?.session || state?.ui?.view==='ready')) $('timer').textContent=settings?formatTime(settings.focusMinutes*60):'--:--';
}
function markDraft() { draftDirty=true; saveVersion++; }
function queueSettingsSave() {
  if (!state || LIVE.has(state.session?.phase)) return;
  clearTimeout(saveTimer);
  const settings=timerSettings();
  if (!settings) { $('saved').textContent='Enter valid times'; return; }
  const token=saveVersion; $('saved').textContent='Saving…';
  // Only an actual in-flight request is awaited by Start. Cancelling a debounce
  // must never leave Start waiting on a promise whose timer can no longer fire.
  saveTimer=setTimeout(()=>{
    if (token!==saveVersion) return;
    pendingSave=(async()=>{
      try {
        const next=await ask('timer-settings',{settings});
        if (token!==saveVersion) return;
        draftDirty=false; $('saved').textContent='Saved'; $('retry-save').hidden=true; showError(); render(next);
      } catch (error) { if (token===saveVersion) { $('saved').textContent='Not saved'; $('retry-save').hidden=false; showError(error.message); } }
    })();
  },280);
}
function paintClock() {
  if (!popup || !state) return;
  const session=state.session, live=LIVE.has(session?.phase), warning=isWarning(session), away=isAway(session), setup=!session||state.ui?.view==='ready';
  if (setup) { $('timer-caption').textContent='Choose focus and break minutes, then start manually.'; preview(); return; }
  const seconds=elapsed(session), goal=Math.floor((session.durationMs||0)/1000), overtime=session.kind==='focus'&&seconds>=goal;
  const repeating=live&&session.kind==='focus'&&session.timerMode==='flow'&&session.goalReached;
  const flowNext=repeating?Math.max(0,(Number(session.rewardsAwarded||0)+1)*goal-seconds):0;
  $('timer').textContent=warning?formatTime(warningRemaining(session)):away?formatTime(awayRemaining(session)):formatTime(live?(repeating?flowNext:(overtime?seconds:remaining(session))):seconds);
  $('timer-caption').textContent=warning?'Time to leave · focus time is frozen':away?'Look back · focus time is frozen':isPaused(session)?'Paused · time excluded':session.kind==='break'?(live?'Rest · no focus rewards accrue':'break elapsed'):session.phase==='focus'?(repeating?(flowNext?'until next reward':'Confirming reward…'):session.goalReached?`Goal reached · ${session.rewardsAwarded||1} reward${(session.rewardsAwarded||1)===1?'':'s'} earned`:overtime?'Confirming completion…':'remaining'):'effective focus in this block';
  $('effective-time').textContent=formatTime(seconds); $('progress').style.width=`${Math.min(100,goal?seconds*100/goal:0)}%`;
}
function renderHistory() {
  const box=$('history-list'); if (!box) return; box.replaceChildren();
  for (const entry of (state?.history||[]).slice(0,8)) {
    const line=document.createElement('p'), mins=Math.round(Number(entry.focusMinutes)||0), when=entry.at?new Date(entry.at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'';
    let text=entry.type==='completed'?`${mins}/${mins} min · +1 reward`:entry.type==='reward'?`${formatTime(Math.floor((Number(entry.effectiveMs)||0)/1000))} · +1 reward`:entry.type==='site-warning'?'Blocked website · 10-second warning':entry.type==='warning-cleared'?'Blocked website left · focus resumed':entry.type==='away-warning'?'Looked away · 10-second warning':entry.type==='away-cleared'?'Looked back · focus resumed':entry.type==='cancelled'?`${formatTime(Math.floor((Number(entry.effectiveMs)||0)/1000))} / ${mins}:00 · No reward`:entry.type==='failed'?((Number(entry.rewardsKept)||0)>0||entry.rewardDelta>0||/reward was earned/i.test(entry.reason||'')?'Blocked website · Reward kept':'Blocked website · No reward'):entry.type==='claim'?'Reward collection requested':String(entry.type||'Activity');
    line.textContent=when?`${when} · ${text}`:text; box.append(line);
  }
}
function render(next) {
  state=next; const session=state.session, settings=state.settings, live=LIVE.has(session?.phase), phase=session?.phase||'idle';
  const paused=isPaused(session), warning=isWarning(session), setup=!session||state.ui?.view==='ready', summary=rewardSummary(state), hardware=state.hardware||{};
  const sending=(state.ledger?.claims||[]).some(claim=>claim.status==='sending');
  if (!popup) { const value=settings.blockedHosts.join('\n'); if (value!==websiteSignature) { $('website-rules').value=value; websiteSignature=value; } $('website-settings-fields').disabled=live; return; }
  const away=isAway(session);
  document.body.dataset.phase=phase; document.body.dataset.paused=String(paused); document.body.dataset.warning=String(warning); document.body.dataset.setup=String(setup);
  $('phase').textContent=setup?'READY WHEN YOU ARE':warning?'LEAVE BLOCKED SITE':away?'LOOK BACK AT THE SCREEN':paused?'PAUSED':({focus:session.timerMode==='flow'&&session.goalReached?'QUIET FLOW · STILL FOCUSING':`FOCUSING · ${Math.round(session.durationMs/60000)} MIN GOAL`,break:'TAKE A BREATHER',completed:session.kind==='break'?'BREAK COMPLETE':'FOCUS COMPLETE',failed:'DISTRACTION DETECTED',fault:'MONITORING INTERRUPTED'}[phase]||'READY');
  $('timer-settings-form').hidden=!setup; $('settings-fields').disabled=live; $('preferences-fields').disabled=live; $('progress-track').hidden=!live; $('focus-meta').hidden=!(live&&session.kind==='focus');
  const reason=session?.reason || (state.history?.[0]?.type==='cancelled'?state.history[0].reason:'');
  const warningHost=session?.siteWarning?.host||'the blocked website';
  $('message').hidden=!away&&!reason&&setup&&!warning;
  const notificationNote=warning&&state.notificationPermission==='denied'?' Browser notifications are disabled; keep this popup open to see the countdown.':'';
  $('message').textContent=warning?`Leave ${warningHost} within ${warningRemaining(session)} seconds. Focus time is frozen; leaving the site resumes this session.${notificationNote}`:away?`Look back at the screen within ${awayRemaining(session)} seconds. Focus time is frozen; looking back resumes this session.`:paused?`${reason||'Timer paused. Resume manually when ready.'} Paused time is excluded.`:reason||(phase==='focus'?(session.timerMode==='flow'?'Flow continues quietly past your goal. Finish whenever you choose.':'A reminder marks your goal. Finish whenever you choose.'):'Breaks never earn focus rewards.');
  const earned=Number(session?.rewardsAwarded)||0, durationSeconds=Math.floor((session?.durationMs||0)/1000);
  $('goal-label').textContent=phase==='focus'&&session?.goalReached&&session?.timerMode!=='flow'?`Goal complete · ${earned||1} reward${(earned||1)===1?'':'s'} earned`:phase==='focus'&&session?.timerMode==='flow'&&earned>0?`${earned} reward${earned===1?'':'s'} earned · next at ${formatTime((earned+1)*durationSeconds)}`:`Next reward at ${formatTime(durationSeconds)}`;
  $('mode-help').textContent=settings.timerMode==='flow'?'Quiet Flow: one reward per full selected interval and no goal interruption.':'Pomodoro: one reward per run with a reminder at the selected goal.';
  $('migration-notice').hidden=!state.migrationNotice; $('migration-notice').textContent=state.migrationNotice||'';
  $('start').hidden=live||(!setup&&phase==='completed'); $('start').textContent=state.activeBlocked?'Leave blocked site to restart':phase==='failed'?'Restart focus':'Start focus'; $('new-focus').hidden=live||setup;
  $('pause').hidden=!live||paused; $('resume').hidden=!paused; $('resume').textContent=session?.kind==='break'?'Resume break':'Resume focus';
  $('finish').hidden=!(live && (session.kind==='break'||session.goalReached)); $('finish').textContent=session?.kind==='break'?'Finish break':(session?.goalReached&&state.restMs>0?'Finish & take a break':'Finish focus');
  $('finish-without-break').hidden=!(live&&session.kind==='focus'&&session.goalReached&&state.restMs>0);
  $('cancel').hidden=!(live&&session.kind==='focus'&&!session.goalReached); $('break').hidden=live||!(state.restMs>0); $('break').textContent=`Start ${formatTime(Math.ceil((state.restMs||0)/1000))} break`;
  $('reward-panel').hidden=setup&&summary.available===0&&summary.unconfirmed===0; $('reward-available').textContent=String(summary.available); $('run-rewards').hidden=setup||session?.kind!=='focus'; $('run-rewards').textContent=`This run: ${earned} earned`; $('reward-detail').textContent=summary.available?`${summary.available} earned reward${summary.available===1?'':'s'} ready to collect.`:'No rewards available yet.';
  $('claim-status').textContent=sending?'Sending one claim. Keep the device connected.':summary.unconfirmed?`${summary.unconfirmed} unconfirmed claim(s) reserved; no retry.`:summary.confirmed?`${summary.confirmed} device acknowledgement(s) recorded.`:hardware.connected?'Collect manually when ready.':'Connect a device to collect. Rewards stay saved.';
  $('collect').hidden=summary.available===0&&!sending; $('collect').disabled=!hardware.connected||sending||summary.available<1; $('collect').textContent=sending?'Collecting…':`Collect 1 reward${summary.available>1?` · ${summary.available} available`:''}`;
  $('hardware-status').textContent=hardware.connected?(hardware.mode==='test'?'USB · LED test only':'USB · BANK device'):'Device disconnected'; $('usb-settings').textContent=usbBusy?'Connecting…':hardware.connected?'Disconnect device':'Connect device'; $('usb-settings').disabled=usbBusy||sending; $('completed').textContent=`Total earned: ${Number(state.ledger?.earned)||0}`;
  const signature=JSON.stringify({focusMinutes:settings.focusMinutes,breakMinutes:settings.breakMinutes,timerMode:settings.timerMode,sound:settings.sound,requireArduino:settings.requireArduino,eyeTracking:settings.eyeTracking});
  if (signature!==timerSignature && !draftDirty) { $('focus-minutes').value=settings.focusMinutes; $('break-minutes').value=settings.breakMinutes; $('timer-mode').value=settings.timerMode; $('sound-enabled').checked=settings.sound; $('arduino-required').checked=settings.requireArduino; $('eye-tracking').checked=Boolean(settings.eyeTracking); timerSignature=signature; }
  const eyeStatus={watching:'Camera on · watching for focus',starting:'Starting camera…',denied:'Camera blocked · click Set up camera','no-camera':'No camera found',error:'Eye tracking could not start'}[state.attentionStatus];
  $('eye-tracking-status').textContent=eyeStatus||(settings.eyeTracking?'Camera turns on during focus':'');
  const access=state.pageWarningAccess||{}, accessKey=JSON.stringify({available:Boolean(access.available),granted:Boolean(access.granted),siteCount:Number(access.siteCount)||0});
  if (pageWarningStatusKey&&pageWarningStatusKey!==accessKey) pageWarningStatus='';
  pageWarningStatusKey=accessKey;
  if ($('enable-page-warnings')) {
    $('enable-page-warnings').disabled=!access.available;
    $('page-warning-status').textContent=pageWarningStatus||(access.granted?`Enabled for ${access.siteCount||0} blocked site${access.siteCount===1?'':'s'}`:access.available?'Optional: allow a countdown banner on blocked sites.':'Browser permission support unavailable.');
  }
  $('history-panel').hidden=!(state.history||[]).length; renderHistory(); renderPresets(settings); preview(); paintClock();
}
async function action(type,extra={}) { showError(); try { const result=await ask(type,extra); render(result); return true; } catch (error) { showError(error.message); return false; } }
const on=(id,event,fn)=>$(id)?.addEventListener(event,fn);
if (popup) {
  on('start','click',async()=>{ const settings=timerSettings(); if (!settings) return; clearTimeout(saveTimer); saveVersion++; draftDirty=false; await (pendingSave||Promise.resolve()); await action('start',{kind:'focus',settings}); });
  on('break','click',()=>action('start',{kind:'break'})); on('new-focus','click',()=>action('prepare-focus')); on('finish','click',()=>action(state?.session?.kind==='focus'&&state.session.goalReached&&state.restMs>0?'finish-break':'finish')); on('finish-without-break','click',()=>action('finish')); on('cancel','click',()=>$('cancel-dialog').showModal()); on('resume','click',()=>action('resume')); on('collect','click',()=>action('collect')); on('pause','click',()=>$('pause-dialog').showModal());
  on('pause-dialog','close',()=>{const d=$('pause-dialog'),result=d.returnValue;d.returnValue='';if(result==='confirm')action('pause',{confirmed:true});}); on('cancel-dialog','close',()=>{const d=$('cancel-dialog'),result=d.returnValue;d.returnValue='';if(result==='confirm')action('cancel',{confirmed:true});}); on('timer-settings-form','submit',event=>event.preventDefault());
  for (const id of ['focus-minutes','break-minutes','timer-mode']) { on(id,'input',()=>{markDraft();preview();queueSettingsSave();}); on(id,'change',queueSettingsSave); on(id,'blur',queueSettingsSave); }
  on('retry-save','click',()=>{ $('retry-save').hidden=true; queueSettingsSave(); });
  on('save-preset','click',()=>{const settings=validForm();if(settings)action('save-preset',{preset:{focusMinutes:settings.focusMinutes,breakMinutes:settings.breakMinutes}});}); on('settings-toggle','click',()=>{const open=$('settings-view').hidden;$('settings-view').hidden=!open;$('timer-view').hidden=open;$('settings-toggle').setAttribute('aria-expanded',String(open));}); on('settings-close','click',()=>$('settings-toggle').click());
  on('enable-page-warnings','click',()=>{
    const hosts=state?.settings?.blockedHosts||[], origins=warningOrigins(hosts);
    const request=chrome.permissions?.request;
    if (!request || !origins.length) { pageWarningStatus='Add a blocked site first.'; render(state); return; }
    // Chrome requires permissions.request to run directly from the user gesture.
    const result=request.call(chrome.permissions,{origins});
    Promise.resolve(result).then(granted=>{ state.pageWarningAccess={...(state.pageWarningAccess||{}),available:true,granted:Boolean(granted),siteCount:hosts.length}; pageWarningStatus=granted?'Enabled for your blocked sites.':'Permission not granted; browser notifications may also be disabled.'; pageWarningStatusKey=JSON.stringify({available:true,granted:Boolean(granted),siteCount:hosts.length}); render(state); }).catch(()=>{pageWarningStatus='Permission not granted; browser notifications may also be disabled.';render(state);});
  });
  on('save-preferences','click',async()=>{if(await action('timer-settings',{settings:{sound:$('sound-enabled').checked,requireArduino:$('arduino-required').checked,eyeTracking:$('eye-tracking').checked}}))$('preferences-saved').textContent='Preferences saved';}); on('camera-setup','click',()=>action('open-camera-setup')); for (const cue of ['success','failure']) on(`test-${cue}`,'click',()=>action('test-alert',{cue})); on('website-settings','click',()=>action('open-dashboard',{section:'websites'}));
  on('usb-settings','click',async()=>{showError();if(state.hardware.connected){await action('disconnect-device');return;}if(!navigator.serial){showError('Web Serial is unavailable. Use desktop Chrome.');return;}try{const port=await navigator.serial.requestPort();usbBusy=true;render(state);await action('connect-device',{portInfo:port.getInfo()});}catch(error){if(error.name!=='NotFoundError')showError(error.message);}finally{usbBusy=false;if(state)render(state);}}); setInterval(paintClock,250);
} else on('website-settings-form','submit',async event=>{event.preventDefault();if(await action('website-settings',{settings:{blockedHosts:$('website-rules').value}}))$('website-saved').textContent='Saved';});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.state)ask('get').then(render).catch(error=>showError(error.message));}); setInterval(()=>ask('get').then(render).catch(error=>showError(error.message)),1000); action('get');
