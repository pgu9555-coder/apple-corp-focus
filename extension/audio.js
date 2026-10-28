// Musical cues and their routing share one testable interface.
export const CUES=Object.freeze({success:[523.25,659.25,783.99,1046.5],failure:[523.25,415.30,349.23,261.63]});
export function alertCue(state){
  if(!state?.settings?.sound)return null;
  const s=state.session;
  if(['failed','fault'].includes(s?.phase))return 'failure';
  if(s?.kind==='break'&&s.phase==='completed')return 'success';
  if(s?.kind==='focus'&&s.phase==='focus'&&s.timerMode==='pomodoro'&&s.goalReached)return 'success';
  return null;
}
let context,tail=Promise.resolve();
export function playCue(cue){
  if(!Object.hasOwn(CUES,cue))return Promise.reject(Error('Unknown sound cue.'));
  const result=tail.then(()=>renderCue(cue));tail=result.catch(()=>{});return result;
}
async function renderCue(cue){
  context??=new AudioContext();
  let timeout;
  try{await Promise.race([context.resume(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Audio playback was blocked. Check Chrome audio settings.')),2000);})]);}
  finally{clearTimeout(timeout);}
  if(context.state!=='running')throw Error('Chrome audio is not running.');
  const analyser=context.createAnalyser();analyser.fftSize=2048;analyser.connect(context.destination);
  const start=context.currentTime+0.03,step=cue==='success'?0.16:0.21,notes=CUES[cue],nodes=[];
  const ended=notes.map((frequency,index)=>new Promise(resolve=>{
    const oscillator=context.createOscillator(),gain=context.createGain(),at=start+index*step;
    oscillator.type='sine';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(0.14,at+0.015);gain.gain.exponentialRampToValueAtTime(0.001,at+step-0.02);
    oscillator.connect(gain);gain.connect(analyser);oscillator.onended=resolve;oscillator.start(at);oscillator.stop(at+step);nodes.push(oscillator,gain);
  }));
  const samples=new Float32Array(analyser.fftSize);let peak=0;
  const sample=setInterval(()=>{analyser.getFloatTimeDomainData(samples);for(const value of samples)peak=Math.max(peak,Math.abs(value));},20);
  try{
    await Promise.race([Promise.all(ended),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Audio rendering did not complete.')),2500);})]);
    if(!(peak>0))throw Error('Chrome did not render an audible signal.');
    return {cue,contextState:context.state,peak,renderedSeconds:context.currentTime-start};
  }finally{clearTimeout(timeout);clearInterval(sample);nodes.forEach(node=>node.disconnect());analyser.disconnect();}
}
