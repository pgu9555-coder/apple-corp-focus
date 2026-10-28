export const DEFAULTS=Object.freeze({focusMinutes:25,breakMinutes:5,sound:true,requireArduino:false,timerMode:'flow',blockedHosts:['youtube.com','reddit.com','instagram.com','tiktok.com','facebook.com','x.com','twitter.com','twitch.tv']});
export const LIVE=new Set(['focus','break']);
const MAX_GAP=90000;
export function hostname(url){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)?u.hostname.toLowerCase().replace(/\.+$/,''):'';}catch{return '';}}
export function normalizeHosts(input){const entries=Array.isArray(input)?input:String(input??'').split(/[\n,]+/);if(entries.length>200)throw Error('Use at most 200 distracting domains.');return [...new Set(entries.map(value=>{const text=String(value).trim().toLowerCase();if(!text)return '';if(text.includes('*'))throw Error('Enter domains without wildcards; subdomains are included.');const u=new URL(text.includes('://')?text:`https://${text}`);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)throw Error('Use domains only, for example youtube.com.');const host=hostname(u.href);if(!host||host.length>253||!/^[a-z0-9.-]+$/.test(host)||host.split('.').some(p=>!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(p)))throw Error('One of the domains is invalid.');return host.replace(/^www\./,'');}).filter(Boolean))];}
export function blockedHost(url,hosts){const host=hostname(url);return host&&hosts.some(rule=>host===rule||host.endsWith(`.${rule}`))?host:'';}
export function settingsFrom(input={}){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Settings must be an object.');const s={...DEFAULTS,...input};s.focusMinutes=Number(s.focusMinutes);if(!Number.isInteger(s.focusMinutes)||s.focusMinutes<1||s.focusMinutes>180)throw Error('Focus time must be 1–180 whole minutes.');let rest=input.breakMinutes;if(!Object.prototype.hasOwnProperty.call(input,'breakMinutes')){if(input.ratioFocus!=null||input.ratioRest!=null){const focus=Number(input.ratioFocus),part=Number(input.ratioRest);if(!Number.isFinite(focus)||focus<=0||!Number.isFinite(part)||part<=0)throw Error('Legacy ratio values must be positive.');rest=s.focusMinutes*part/focus;}else if(input.focusBreakRatio!=null)rest=s.focusMinutes/Number(input.focusBreakRatio);else rest=DEFAULTS.breakMinutes;}s.breakMinutes=Number(rest);if(!Number.isFinite(s.breakMinutes)||s.breakMinutes<=0||s.breakMinutes>180)throw Error('Break time must be positive and no more than 180 minutes.');if(!['pomodoro','flow'].includes(s.timerMode))throw Error('Unknown timer mode.');return {focusMinutes:s.focusMinutes,breakMinutes:s.breakMinutes,timerMode:s.timerMode,sound:Boolean(s.sound),requireArduino:Boolean(s.requireArduino),blockedHosts:normalizeHosts(s.blockedHosts)};}
export function isPaused(s){return Boolean(s&&LIVE.has(s.phase)&&s.pausedAt!=null);}
export const SITE_GRACE_MS=10000;
export function isWarning(s){return Boolean(s?.phase==='focus'&&s.siteWarning&&!isPaused(s));}
export function warningRemaining(s,now=Date.now()){return isWarning(s)?Math.max(0,Math.ceil((s.siteWarning.deadlineAt-now)/1000)):0;}
export function elapsed(s,now=Date.now()){if(!s)return 0;const extra=LIVE.has(s.phase)&&!isPaused(s)&&!isWarning(s)&&now>=s.accountedAt&&now-s.accountedAt<=MAX_GAP?now-s.accountedAt:0;return Math.floor(((s.effectiveMs||0)+extra)/1000);}
export function remaining(s,now=Date.now()){return s&&LIVE.has(s.phase)?Math.max(0,Math.ceil((s.durationMs-elapsed(s,now)*1000)/1000)):0;}
export function needsDeviceLease(){return false;}
export function formatTime(seconds){seconds=Math.max(0,Math.floor(seconds));return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;}
const presetId=(f,b)=>`${f}-${b}`;
export const initialState=()=>({schema:5,settings:settingsFrom(),presets:[{id:presetId(25,5),focusMinutes:25,breakMinutes:5},{id:presetId(50,10),focusMinutes:50,breakMinutes:10}],session:null,stats:{completed:0,failed:0,cancelled:0},restMs:0,ledger:{earned:0,claims:[]},history:[],migrationNotice:'',ui:{view:'ready'}});
export function rewardSummary(state){const l=state?.ledger||{earned:0,claims:[]},claims=l.claims||[];return {available:Math.max(0,(l.earned||0)-claims.length),remainderMs:0,nextRewardMs:0,unconfirmed:claims.filter(c=>c.status==='unconfirmed').length,confirmed:claims.filter(c=>c.status==='confirmed').length,simulated:claims.filter(c=>c.status==='simulated').length};}
export class Controller{
 constructor(io){this.io=io;this.state=initialState();this.tail=Promise.resolve();this.revision=0;}
 run(fn){const next=this.tail.then(fn);this.tail=next.catch(()=>{});return next;}
 snapshot(){return structuredClone({...this.state,hardware:this.io.hardware()});}
 async save(){await this.io.save(this.state);this.io.changed?.(this.snapshot());}
 async schedule(){await this.io.schedule?.(this.state.session);}
 addHistory(type,extra={}){const s=this.state.session;this.state.history.unshift({id:this.io.uuid().replaceAll('-',''),at:this.io.now(),type,sessionId:s?.id||'',focusMinutes:s?.focusMinutes??this.state.settings.focusMinutes,effectiveMs:s?.effectiveMs||0,rewardDelta:extra.rewardDelta||0,...extra});this.state.history=this.state.history.slice(0,100);}
 normalizePresets(ps){const source=Array.isArray(ps)?ps:initialState().presets,out=[];for(const p of source){const f=Number(p?.focusMinutes),b=Number(p?.breakMinutes);if(Number.isInteger(f)&&f>=1&&f<=180&&Number.isFinite(b)&&b>0&&b<=180&&!out.some(x=>x.focusMinutes===f&&x.breakMinutes===b))out.push({id:p.id||presetId(f,b),focusMinutes:f,breakMinutes:b});}return out;}
 async load(saved,sameBrowserSession){if(saved&&saved.schema>=5)this.state={...initialState(),...structuredClone(saved),schema:5,settings:settingsFrom(saved.settings||{}),presets:this.normalizePresets(saved.presets),history:Array.isArray(saved.history)?saved.history.slice(0,100):[]};else if(saved&&[1,2,3,4].includes(saved.schema)){this.state=initialState();this.state.settings=settingsFrom(saved.settings||{});this.state.migrationNotice='Your previous timer data was cleared for the new session-reward rules.';}let changed=false;const session=this.state.session;if(session&&session.kind==='focus'&&!Number.isInteger(session.rewardsAwarded)){session.rewardsAwarded=session.rewardEarned?1:0;changed=true;}for(const c of this.state.ledger.claims||[])if(c.status==='sending'){c.status='unconfirmed';changed=true;}if(this.state.session&&LIVE.has(this.state.session.phase))this.state.ui.view='session';if(this.state.session&&LIVE.has(this.state.session.phase)&&!sameBrowserSession&&!isPaused(this.state.session)){await this.autoPause('Chrome restarted or the extension reloaded. Unobserved time was excluded.');changed=false;}if(changed||saved?.schema!==5)await this.save();await this.schedule();}
 findBlocked(active,hosts){for(const url of active?.urls||[]){const h=blockedHost(url,hosts);if(h)return h;}return '';}
 async freshHost(hosts){const rev=this.revision,host=this.findBlocked(await this.io.active(),hosts);if(rev!==this.revision)throw Error('Browser activity changed. Please try again.');return host;}
 async settings(input,scope='all'){if(LIVE.has(this.state.session?.phase))throw Error('Settings are locked while a block is active.');if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Settings must be an object.');if(scope!=='all'){const fields={timer:['focusMinutes','breakMinutes','timerMode','sound','requireArduino'],websites:['blockedHosts']}[scope];if(!fields)throw Error('Unknown settings scope.');if(Object.keys(input).some(k=>!fields.includes(k)))throw Error('A setting is outside the allowed scope.');input={...this.state.settings,...input};}this.state.settings=settingsFrom(input);await this.save();return this.snapshot();}
 async savePreset(input){const f=Number(input?.focusMinutes),b=Number(input?.breakMinutes);settingsFrom({focusMinutes:f,breakMinutes:b,blockedHosts:this.state.settings.blockedHosts});if(!this.state.presets.some(p=>p.focusMinutes===f&&p.breakMinutes===b)){if(this.state.presets.length>=12)throw Error('You can save up to 12 presets.');this.state.presets.push({id:presetId(f,b),focusMinutes:f,breakMinutes:b});}await this.save();return this.snapshot();}
 async deletePreset(id){this.state.presets=this.state.presets.filter(p=>p.id!==id);await this.save();return this.snapshot();}
 async start(kind='focus'){if(!['focus','break'].includes(kind))throw Error('Unknown timer type.');if(LIVE.has(this.state.session?.phase))throw Error('End the current block first.');const settings=this.state.settings;if(kind==='focus'&&settings.requireArduino&&!this.io.hardware().connected)throw Error('Connect USB from the popup first, or turn off Require Arduino.');const host=kind==='focus'?await this.freshHost(settings.blockedHosts):'';if(host)throw Error(`Leave ${host} before starting focus.`);if(kind==='break'&&!(this.state.restMs>0))throw Error('Finish a focus block before starting its chosen break.');const now=this.io.now(),duration=kind==='focus'?settings.focusMinutes*60000:this.state.restMs;this.state.session={id:this.io.uuid().replaceAll('-',''),kind,phase:kind,timerMode:settings.timerMode,focusMinutes:settings.focusMinutes,breakMinutes:settings.breakMinutes,startAt:now,endAt:now+duration,durationMs:duration,effectiveMs:0,accountedAt:now,lastCheckAt:now,pausedAt:null,pausedTotalMs:0,rewardsAwarded:0,blockedHosts:[...settings.blockedHosts],goalReached:false,rewardEarned:false,reason:'',host:''};this.state.restMs=0;this.state.ui={view:'session'};await this.save();await this.schedule();return this.snapshot();}
 async prepareFocus(){if(this.state.session&&LIVE.has(this.state.session.phase))throw Error('End the current block first.');this.state.ui={view:'ready'};await this.save();return this.snapshot();}
 gapSafe(now){const s=this.state.session;return now>=s.accountedAt&&now-s.accountedAt<=MAX_GAP;}
 reconcile(now){const s=this.state.session;if(!s||!LIVE.has(s.phase)||isPaused(s)||isWarning(s))return;const d=Math.max(0,now-s.accountedAt);s.accountedAt=now;s.lastCheckAt=now;s.effectiveMs+=d;}
 async completeGoal(){const s=this.state.session;if(!s||s.kind!=='focus'||s.effectiveMs<s.durationMs)return false;const durationMs=Number(s.durationMs);const eligible=Math.floor(s.effectiveMs/durationMs);const awarded=Number.isInteger(s.rewardsAwarded)?s.rewardsAwarded:(s.rewardEarned?1:0);if(eligible<=awarded||(s.timerMode==='pomodoro'&&awarded>=1))return false;let credited=false;for(let intervalIndex=awarded+1;intervalIndex<=eligible;intervalIndex++){this.state.ledger.earned++;const first=intervalIndex===1;this.addHistory(first?'completed':'reward',{rewardDelta:1,intervalIndex,effectiveMs:intervalIndex*durationMs});if(first){s.goalReached=true;s.rewardEarned=true;this.state.restMs=s.breakMinutes*60000;this.state.stats.completed++;}s.rewardsAwarded=intervalIndex;credited=true;if(s.timerMode==='pomodoro')break;}return credited;}
 stop(phase,reason,host=''){const s=this.state.session;if(!s||!LIVE.has(s.phase))return;s.siteWarning=null;s.phase=phase;s.reason=reason;s.host=host;s.finishedAt=this.io.now();this.state.ui={view:'session'};if(phase==='failed')this.state.stats.failed++;}
 async fault(reason){if(!LIVE.has(this.state.session?.phase))return;await this.autoPause(reason);this.io.alert?.(this.snapshot());}
 async autoPause(reason='Monitoring paused. Resume manually when ready.') {
  const s=this.state.session;
  if(!s||!LIVE.has(s.phase)||isPaused(s))return this.snapshot();
  // Never credit time after the last trusted checkpoint. Emergency pause calls
  // tick() first, while restart/lock/unsafe-gap pauses freeze this exact point.
  const now=this.io.now();
  s.siteWarning=null;s.pausedAt=now;s.accountedAt=now;s.lastCheckAt=now;s.reason=reason;
  this.addHistory('paused',{reason});this.state.ui={view:'session'};
  await this.save();await this.schedule();return this.snapshot();
 }
 async visit(url) {
  const s=this.state.session;
  if(s?.phase!=='focus'||isPaused(s))return;
  const host=blockedHost(url,s.blockedHosts);
  const now=this.io.now();
  if(isWarning(s)){
   if(now<s.siteWarning.startedAt){await this.autoPause('The clock changed during the website warning. Resume manually.');return;}
   // The original deadline survives navigation, popup closure and worker reload.
   if(now>=s.siteWarning.deadlineAt){await this.expireWarning();return;}
   if(host){if(s.siteWarning.host!==host){s.siteWarning.host=host;await this.save();}return;}
   s.siteWarning=null;s.accountedAt=now;s.lastCheckAt=now;
   s.endAt=now+Math.max(0,s.durationMs-s.effectiveMs);s.reason='';
   this.addHistory('warning-cleared',{reason:'Left blocked sites before the deadline; focus resumed.'});
   await this.save();await this.schedule();return;
  }
  if(!host)return;
  if(!this.gapSafe(now)){await this.autoPause('Monitoring was interrupted or the clock changed. Unobserved time was excluded.');return;}
  this.reconcile(now);await this.completeGoal();
  s.siteWarning={host,startedAt:now,deadlineAt:now+SITE_GRACE_MS};
  this.addHistory('site-warning',{host,reason:'Leave blocked sites within 10 seconds. Focus time is frozen.'});
  await this.save();await this.schedule();this.io.warning?.(this.snapshot());
 }
 async expireWarning(){
  const s=this.state.session;if(!isWarning(s))return;
  const host=s.siteWarning.host,observed=s.effectiveMs;
  this.stop('failed',`Focus stopped at ${host} after the 10-second warning. Earned rewards were kept; incomplete progress was reset.`,host);
  this.addHistory('failed',{reason:s.reason,effectiveMs:observed,rewardsKept:s.rewardsAwarded||0});
  s.effectiveMs=(s.rewardsAwarded||0)*s.durationMs;
  await this.save();await this.schedule();this.io.alert?.(this.snapshot());
 }
 async tick(){const s=this.state.session;if(!s||!LIVE.has(s.phase))return;const now=this.io.now();if(isPaused(s))return;if(isWarning(s)){const host=await this.freshHost(s.blockedHosts);await this.visit(host?`https://${host}/`:'');return;}if(!this.gapSafe(now)){await this.autoPause('Monitoring was interrupted or the clock changed. Unobserved time was excluded.');return;}if(s.kind==='focus'){const host=await this.freshHost(s.blockedHosts);if(host){await this.visit(`https://${host}/`);return;}}this.reconcile(now);if(s.kind==='break'&&s.effectiveMs>=s.durationMs){s.effectiveMs=s.durationMs;this.stop('completed','Break finished. Start focus manually when ready.');await this.save();await this.schedule();this.io.alert?.(this.snapshot());return;}const reached=await this.completeGoal();await this.save();if(reached){await this.schedule();if(s.timerMode==='pomodoro')this.io.alert?.(this.snapshot());}}
 async pause(confirmed=false){if(confirmed!==true)throw Error('Pause requires explicit confirmation.');const s=this.state.session;if(!s||!LIVE.has(s.phase))throw Error('No timer is running.');if(isPaused(s))return this.snapshot();await this.tick();if(!LIVE.has(s.phase))throw Error('The block ended before it could be paused.');return this.autoPause('Emergency pause confirmed.');}
 async resume(){
  const s=this.state.session;if(!isPaused(s))throw Error('There is no paused timer to resume.');
  const now=this.io.now();if(now<s.pausedAt)throw Error('The computer clock changed.');
  if(s.kind==='focus'){const host=await this.freshHost(s.blockedHosts);if(host)throw Error(`Leave ${host} before resuming.`);}
  const p=now-s.pausedAt;s.pausedTotalMs+=p;s.endAt=now+Math.max(0,s.durationMs-s.effectiveMs);
  s.pausedAt=null;s.accountedAt=now;s.lastCheckAt=now;s.reason='';this.addHistory('resumed');
  await this.save();await this.schedule();return this.snapshot();
 }
 async finish(){const s=this.state.session;if(!s||!LIVE.has(s.phase))throw Error('No active block to finish.');if(!isPaused(s))await this.tick();if(!LIVE.has(s.phase))return this.snapshot();if(s.kind==='focus'&&!s.goalReached)throw Error('Complete the focus goal or use Cancel session.');this.stop('completed',s.kind==='break'?'Break finished manually.':'Focus finished. Start the chosen break when ready.');await this.save();await this.schedule();return this.snapshot();}
 async cancel(confirmed=false){
  const s=this.state.session;
  if(!s||s.kind!=='focus'||!LIVE.has(s.phase))throw Error('No active focus session.');
  if(!confirmed)throw Error('Cancel requires confirmation.');
  if(!isPaused(s))await this.tick();
  if(!this.state.session||!LIVE.has(this.state.session.phase))throw Error('The session was interrupted; resume or start a new block.');
  if(this.state.session.goalReached)throw Error('The focus goal is complete; finish the session instead.');
  this.addHistory('cancelled',{reason:'Focus cancelled before the goal; no reward earned.'});
  this.state.stats.cancelled++;this.state.session=null;this.state.restMs=0;this.state.ui={view:'ready'};
  await this.save();await this.schedule();return this.snapshot();
 }
 async collect(){if(this.state.ledger.claims.some(c=>c.status==='sending'))throw Error('A reward collection is already sending.');if(rewardSummary(this.state).available<1)throw Error('No reward available.');if(!this.io.hardware().connected)throw Error('Connect USB before collecting.');const claim={id:this.io.uuid().replaceAll('-',''),status:'sending',createdAt:this.io.now()};this.state.ledger.claims.push(claim);this.addHistory('claim',{claimId:claim.id});try{await this.save();}catch(e){this.state.ledger.claims.pop();throw e;}Promise.resolve().then(()=>this.io.command('CLAIM',claim.id,'1')).then(result=>this.run(async()=>{claim.status=result==='DISPENSED'?'confirmed':result==='SIMULATED'?'simulated':'unconfirmed';await this.save();}),()=>this.run(async()=>{claim.status='unconfirmed';await this.save();})).catch(console.error);return this.snapshot();}
}
