import {isWarning,isAway,isPaused} from './core.js';

export function focusNotice(s){
  if(isWarning(s))return {kind:'site',key:s.siteWarning.deadlineAt,deadline:s.siteWarning.deadlineAt,host:s.siteWarning.host};
  if(isAway(s))return {kind:'away',key:s.awayWarning.deadlineAt,deadline:s.awayWarning.deadlineAt};
  if(isPaused(s)&&s.pauseKind==='away')return {kind:'paused',key:s.pausedAt};
  if(isPaused(s)&&s.pauseKind==='camera')return {kind:'camera',key:s.pausedAt};
  if(s?.phase==='failed'&&s.host)return {kind:'ended',key:s.finishedAt,host:s.host};
  return null;
}

export class WarningWindow {
  constructor(api,session){
    this.api=api;
    this.session=session;
    this.url=api.runtime.getURL('focus-warning.html');
    this.key=null;
    this.tail=Promise.resolve();
  }
  isPage(url){return typeof url==='string'&&url.split(/[?#]/)[0]===this.url;}
  refresh(){
    this.tail=this.tail.catch(()=>{}).then(()=>this.sync());
    return this.tail;
  }
  async sync(){
    if(!this.api.windows.create)return;
    const notice=()=>{const s=this.session(),n=focusNotice(s);return n?`${s.id}:${n.kind}:${n.key}`:null;};
    const key=notice();
    if(!key){this.key=null;return;}
    if(key===this.key)return;
    const windows=await this.api.windows.getAll({populate:true,windowTypes:['normal','popup']});
    if(key!==notice())return;
    const tabFor=w=>w.tabs?.find(t=>this.isPage(t.pendingUrl)||this.isPage(t.url));
    const existing=windows.find(tabFor);
    const source=windows.find(w=>w.focused&&!tabFor(w))?.id;
    const url=new URL(this.url);
    if(Number.isInteger(source))url.searchParams.set('source',source);
    if(existing){
      const tab=tabFor(existing);
      if(!existing.focused&&Number.isInteger(source)&&tab.pendingUrl!==url.href&&tab.url!==url.href){
        await this.api.tabs.update(tab.id,{url:url.href});
      }
      if(!existing.focused&&Number.isInteger(existing.id))await this.api.windows.update(existing.id,{focused:true});
      this.key=key;
      return;
    }
    await this.api.windows.create({url:url.href,type:'popup',focused:true,width:440,height:330});
    this.key=key;
  }
}
