import {focusNotice} from './warning-window.js';

const $=id=>document.getElementById(id);
const count=$('count');
let deadline=null;
let changed=false;
const copy={
  site:['Leave the blocked website',host=>`Focus time is frozen. Go back to your browser and leave ${host} to continue.`],
  away:['Look back at the screen',()=> 'Focus time is frozen. Look back before the countdown ends to keep going.'],
  paused:['Focus paused',()=> 'Look back at the screen to resume automatically.'],
  camera:['Camera needs attention',()=> 'Focus is paused. Open Set up camera to fix camera access, then resume manually from Focus Machine.'],
  ended:['Focus session ended',host=>`You stayed on ${host} after the warning expired. Earned rewards are kept.`],
};
function drawClock(){
  if(deadline===null)return;
  const seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));
  const value=`00:${String(seconds).padStart(2,'0')}`;
  if(count.textContent!==value)count.textContent=value;
}
function show(state){
  const n=focusNotice(state?.session);
  if(!n){window.close();return;}
  const [title,message]=copy[n.kind];
  $('notice').dataset.kind=n.kind;
  if($('title').textContent!==title)$('title').textContent=title;
  const text=message(n.host);
  if($('message').textContent!==text)$('message').textContent=text;
  $('dismiss').hidden=!['ended','camera'].includes(n.kind);
  deadline=n.deadline??null;
  count.hidden=deadline===null;
  drawClock();
}
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes.state){changed=true;show(changes.state.newValue);}
});
chrome.storage.local.get('state').then(({state})=>{if(!changed)show(state);});
$('dismiss').addEventListener('click',()=>window.close());
setInterval(drawClock,200);
