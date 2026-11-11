import {AttentionMonitor} from './attention.js';

// Setup page: an offscreen document cannot show Chrome's camera permission prompt,
// so the user grants camera access once on this visible extension page.
const $=id=>document.getElementById(id);

const STATUS_TEXT={
  starting:'Starting camera…',
  watching:'Camera ready',
  denied:'Camera blocked. Allow it from the camera icon in the address bar, then try again.',
  'no-camera':'No camera found.',
  error:'The detector could not start.',
  off:'Camera off.',
};
const REASON_TEXT={ok:'Looking at the screen',turned:'Looking away','no-face':'No face found','eyes-closed':'Eyes closed'};

let monitor=null;
let gazeTimer=null;
let step=-1;
const PRACTICE_STEPS=[
  '1/5 · Look at the screen normally.',
  '2/5 · Turn your head left or right and hold for about 2 seconds.',
  '3/5 · Face the screen again and hold still.',
  '4/5 · Move out of the camera frame for about 2 seconds.',
  '5/5 · Come back into frame and face the screen.',
  'Complete: head turn, leaving the frame, and both returns were detected.',
];

function updatePractice(frame){
  const live=$('practice-live');
  const present=monitor.filter.present;
  live.dataset.state=frame.reason?(present?'present':'away'):'';
  live.textContent=!frame.reason?'Waiting for frames…':present?'Timer would continue':'Timer would freeze · away confirmed';
  if(step<0||step>=PRACTICE_STEPS.length-1||!frame.reason)return;
  const returned=present&&frame.looking;
  const confirmedAway=!present&&!frame.looking;
  const passed=[returned,confirmedAway&&frame.reason==='turned',returned,confirmedAway&&frame.reason==='no-face',returned][step];
  if(passed)$('practice-step').textContent=PRACTICE_STEPS[++step];
}

$('practice-start').addEventListener('click',()=>{
  step=0;
  $('practice-step').textContent=PRACTICE_STEPS[step];
  $('practice-start').textContent='Restart practice';
});

// The saved calibration is read once when the page loads; the monitor is created on Allow.
const baselineReady=chrome.storage.local.get('attentionBaseline')
  .then(({attentionBaseline})=>attentionBaseline??null)
  .catch(()=>null);

const DASH='—';
const degrees=value=>value==null?DASH:`${value.toFixed(0)}°`;

function showGaze(){
  const frame=monitor?.lastFrame??{};
  updatePractice(frame);
  const video=$('preview');
  const camera=monitor?.stream?.getVideoTracks()[0]?.label||'Camera';
  const size=video.videoWidth?video.videoWidth+' × '+video.videoHeight:'waiting for video';
  $('diagnostics').textContent=camera+' · '+size+' · Faces found in '+monitor.framesWithFace+' / '+monitor.framesChecked+' checked frames';
  $('gaze').textContent=frame.reason?(REASON_TEXT[frame.reason]??''):'Waiting for camera…';
  const blink=frame.blinkLeft==null&&frame.blinkRight==null?null:((frame.blinkLeft??0)+(frame.blinkRight??0))/2;
  const blinkText=blink==null?DASH:`${(blink*100).toFixed(0)}%`;
  let numbers=`Head left/right ${degrees(frame.yaw)}, up/down ${degrees(frame.pitch)}, eyes closed ${blinkText}`;
  const b=monitor?.baseline;
  if(b)numbers+=` · calibrated at ${b.yaw.toFixed(0)}°, ${b.pitch.toFixed(0)}°`;
  $('numbers').textContent=numbers;
}

function startGaze(){
  stopGaze();
  gazeTimer=setInterval(showGaze,300);
  showGaze();
}

function stopGaze(){
  clearInterval(gazeTimer);
  gazeTimer=null;
}

function onStatus(status,error){
  $('status').textContent=(STATUS_TEXT[status]??'')+(error?' ('+error.name+': '+error.message+')':'');
  $('calibrate').disabled=status!=='watching';
  $('practice-start').disabled=status!=='watching';
  const active=status==='watching'||status==='starting';
  $('allow').disabled=active;
  $('done').disabled=!active;
  $('practice-stop').disabled=!active;
  if(status==='watching')startGaze();
  else{
    stopGaze();
    $('gaze').textContent='';
    $('numbers').textContent='';
    $('diagnostics').textContent='';
    step=-1;
    $('practice-live').textContent=status==='starting'?'Starting camera…':'Camera off';
    $('practice-live').dataset.state='';
    $('practice-step').textContent='Start the camera to practice.';
    $('practice-start').textContent='Start practice';
  }
}

$('allow').addEventListener('click',async()=>{
  const baseline=await baselineReady;
  monitor??=new AttentionMonitor({video:$('preview'),onStatus,baseline});
  monitor.start();
});

$('calibrate').addEventListener('click',async()=>{
  if(!monitor?.running)return;
  const button=$('calibrate');
  button.disabled=true;
  $('status').textContent='Hold still and look at the screen…';
  try{
    const b=await monitor.calibrate(2000);
    await chrome.storage.local.set({attentionBaseline:b});
    $('status').textContent="Calibrated. This is now your 'looking at the screen' position.";
  }catch(error){
    $('status').textContent=error.message;
  }finally{
    button.disabled=!monitor?.running;
  }
});

function stopTest(){
  monitor?.stop();
  $('practice-step').textContent='Test stopped. Start the camera to try again.';
}
$('done').addEventListener('click',stopTest);
$('practice-stop').addEventListener('click',stopTest);

window.addEventListener('pagehide',()=>{
  monitor?.stop();
  stopGaze();
});
