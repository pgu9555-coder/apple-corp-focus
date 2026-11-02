import {blockedHost, isWarning} from './core.js';

export function warningOrigins(hosts) {
  return [...new Set(hosts)].flatMap(host=>{
    // IP addresses and localhost need exact-host patterns, not subdomain wildcards.
    const target=host==='localhost'||/^\d+(\.\d+){3}$/.test(host)?host:`*.${host}`;
    return [`http://${target}/*`,`https://${target}/*`];
  });
}

export async function warningAccess(api, hosts) {
  const available=Boolean(api.permissions?.contains&&api.scripting?.executeScript);
  const origins=warningOrigins(hosts);
  let granted=false;
  if(available&&origins.length) {
    try { granted=await api.permissions.contains({origins}); } catch { /* Retain notification fallback. */ }
  }
  return {available,granted,siteCount:hosts.length};
}

// Display-only adapter. It never changes timer state or requests permission.
export class PageWarnings {
  constructor(api,getState) { this.api=api;this.getState=getState;this.tail=Promise.resolve();this.visible=new Map(); }
  refresh() {
    // Read fresh state when a queued refresh runs; never replay an old warning.
    this.tail=this.tail.catch(()=>{}).then(()=>this.sync());
    return this.tail;
  }
  invalidate(tabId) { if(tabId==null)this.visible.clear();else this.visible.delete(tabId); }
  async clearExcept(keep) {
    for(const tabId of this.visible.keys())if(tabId!==keep){
      this.visible.delete(tabId);
      await this.api.tabs.sendMessage(tabId,{type:'apple-focus-warning',warning:null}).catch(()=>{});
    }
  }
  async sync() {
    const state=this.getState(),session=state.session;
    if(!isWarning(session)){await this.clearExcept(null);return;}
    const windows=await this.api.windows.getAll({populate:true,windowTypes:['normal','popup']});
    const win=windows.find(w=>w.focused),tab=win?.tabs?.find(t=>t.active);
    const url=tab?.url||'',host=blockedHost(url,session.blockedHosts);
    if(!tab||!host||!this.api.scripting?.executeScript||!this.api.permissions?.contains){await this.clearExcept(null);return;}
    await this.clearExcept(tab.id);
    const origin=`${new URL(url).origin}/*`;
    if(!await this.api.permissions.contains({origins:[origin]})){await this.clearExcept(null);return;}
    const key=`${session.id}:${session.siteWarning.deadlineAt}:${url}`;
    if(this.visible.get(tab.id)===key)return;
    await this.api.scripting.executeScript({target:{tabId:tab.id},files:['warning-banner.js'],injectImmediately:true});
    const current=this.getState().session;
    if(!isWarning(current)||current.id!==session.id||current.siteWarning.deadlineAt!==session.siteWarning.deadlineAt){
      await this.api.tabs.sendMessage(tab.id,{type:'apple-focus-warning',warning:null}).catch(()=>{});return;
    }
    // Check attention again after injection to avoid showing a warning on an old tab.
    const latest=await this.api.tabs.get(tab.id);
    const focused=await this.api.windows.get(latest.windowId);
    if(!latest.active||!focused.focused||latest.url!==url)return;
    await this.api.tabs.sendMessage(tab.id,{type:'apple-focus-warning',warning:{
      sessionId:current.id,host,deadlineAt:current.siteWarning.deadlineAt,
    }});
    this.visible.set(tab.id,key);
  }
}
