// Camera-based "looking at the screen" detector.
// Privacy: video frames stay on this computer. They are never stored, never drawn
// to a canvas for export, and never sent anywhere. Only the derived yes/no signal
// (looking or not) leaves this module through onChange.

const DEFAULT_LIMITS={maxYaw:30,maxPitch:25,maxPitchDown:17,blink:0.6};
const TICK_MS=200;
const HEARTBEAT_MS=3000;
const MAX_FRAME_ERRORS=5;

const toDegrees=radians=>radians*180/Math.PI;

// matrixData is a 16-number, column-major 4x4 facial transformation matrix.
// Rotation entry R[row][col] lives at data[col*4+row].
export function headPose(matrixData){
  const R=(row,col)=>matrixData[col*4+row];
  const yaw=Math.atan2(-R(2,0),Math.sqrt(R(0,0)**2+R(1,0)**2));
  let pitch=toDegrees(Math.atan2(R(2,1),R(2,2)));
  // A frontal face can come out as pitch ±180 when the matrix's axes are flipped.
  // Fold it into (-90, 90] so a face looking straight at the camera reads as 0.
  if(pitch>90)pitch-=180;
  else if(pitch<=-90)pitch+=180;
  // "+ 0" turns -0 (identity yaw) into 0.
  return {yaw:toDegrees(yaw)+0,pitch:pitch+0};
}

// Returns a measurement object every time. Yaw, pitch and blink values are null
// when the model did not supply them. Head angles are compared to the calibrated
// baseline when one is given, otherwise to 0. Eyes count as closed only when
// both blink scores are above the threshold.
export function classifyFrame(result,limits={},baseline=null){
  const lim={...DEFAULT_LIMITS,...limits};
  const measured={yaw:null,pitch:null,blinkLeft:null,blinkRight:null};
  if(!result?.faceLandmarks?.length)return {looking:false,reason:'no-face',...measured};

  const matrix=result.facialTransformationMatrixes?.[0]?.data;
  if(matrix){
    const {yaw,pitch}=headPose(matrix);
    measured.yaw=yaw;
    measured.pitch=pitch;
  }

  const categories=result.faceBlendshapes?.[0]?.categories;
  if(categories){
    const score=name=>categories.find(c=>c.categoryName===name)?.score??0;
    measured.blinkLeft=score('eyeBlinkLeft');
    measured.blinkRight=score('eyeBlinkRight');
  }

  const {yaw,pitch,blinkLeft,blinkRight}=measured;
  const baseYaw=baseline?.yaw??0;
  const basePitch=baseline?.pitch??0;
  const closed=baseline?Math.min(0.95,Math.max(lim.blink,baseline.blink+0.3)):lim.blink;

  let reason='ok';
  // Positive pitch relative to calibration corresponds to tilting down.
  if(yaw!==null&&pitch!==null&&(Math.abs(yaw-baseYaw)>lim.maxYaw||pitch-basePitch>lim.maxPitchDown||basePitch-pitch>lim.maxPitch))reason='turned';
  else if(blinkLeft!==null&&blinkRight!==null&&blinkLeft>closed&&blinkRight>closed)reason='eyes-closed';
  return {looking:reason==='ok',reason,...measured};
}

// Debounces the raw per-frame looking signal. Starts "present". Reports only
// state changes: true (back to present), false (away), or null (no change).
export class AttentionFilter{
  constructor({awayAfterMs=1500,backAfterMs=500}={}){
    this.awayAfterMs=awayAfterMs;
    this.backAfterMs=backAfterMs;
    this.isPresent=true;
    this.awayRunStart=null;
    this.backRunStart=null;
  }

  get present(){return this.isPresent;}

  update(looking,nowMs){
    if(looking){
      this.awayRunStart=null;
      if(this.isPresent)return null;
      this.backRunStart??=nowMs;
      if(nowMs-this.backRunStart>=this.backAfterMs){
        this.isPresent=true;
        this.backRunStart=null;
        return true;
      }
      return null;
    }
    this.backRunStart=null;
    if(!this.isPresent)return null;
    this.awayRunStart??=nowMs;
    if(nowMs-this.awayRunStart>=this.awayAfterMs){
      this.isPresent=false;
      this.awayRunStart=null;
      return false;
    }
    return null;
  }
}

function cameraErrorStatus(error){
  switch(error?.name){
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no-camera';
    default:
      return 'error';
  }
}

function stopTracks(stream){
  for(const track of stream.getTracks())track.stop();
}

// Accepts only a {yaw, pitch, blink} object of finite numbers. Anything else is null.
function normalizeBaseline(value){
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  if(!value||!finite(value.yaw)||!finite(value.pitch)||!finite(value.blink))return null;
  return {yaw:value.yaw,pitch:value.pitch,blink:value.blink};
}

export class AttentionMonitor{
  constructor({onChange=()=>{},onStatus=()=>{},video=null,baseline=null}={}){
    this.onChange=onChange;
    this.onStatus=onStatus;
    this.video=video;
    this.baseline=normalizeBaseline(baseline);
    this.filter=new AttentionFilter();
    this.lastFrame=null;
    this.framesChecked=0;
    this.framesWithFace=0;
    this.lastVideoTime=null;
    this.lastFrameAt=0;
    this.running=false;
    this.stream=null;
    this.timer=null;
    this.landmarker=null; // cached across start/stop
    this.generation=0;    // bumped by stop() so an in-flight start() can notice
    this.errors=0;
    this.lastBeat=0;
  }

  async start(){
    if(this.running)return;
    this.running=true;
    const generation=++this.generation;
    this.onStatus('starting');

    let stream;
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:15}},audio:false});
    }catch(error){
      if(generation!==this.generation)return;
      this.running=false;
      this.onStatus(cameraErrorStatus(error),error);
      return;
    }
    if(generation!==this.generation){stopTracks(stream);return;}

    try{
      this.stream=stream;
      if(!this.video)this.video=document.createElement('video');
      this.video.muted=true;
      this.video.playsInline=true;
      this.video.srcObject=stream;
      await this.video.play();
      if(generation!==this.generation)return;
      if(!this.landmarker){
        const {FilesetResolver,FaceLandmarker}=await import('./vendor/mediapipe/vision_bundle.mjs');
        const fileset=await FilesetResolver.forVisionTasks(chrome.runtime.getURL('vendor/mediapipe/wasm'));
        this.landmarker=await FaceLandmarker.createFromOptions(fileset,{
          baseOptions:{modelAssetPath:chrome.runtime.getURL('vendor/mediapipe/face_landmarker.task'),delegate:'CPU'},
          runningMode:'VIDEO',
          numFaces:1,
          minFaceDetectionConfidence:0.35,
          minFacePresenceConfidence:0.4,
          outputFaceBlendshapes:true,
          outputFacialTransformationMatrixes:true,
        });
        if(generation!==this.generation)return;
      }
    }catch(error){
      if(generation!==this.generation)return;
      this.release();
      this.onStatus('error',error);
      return;
    }

    this.filter=new AttentionFilter();
    this.errors=0;
    this.lastBeat=0;
    this.framesChecked=0;
    this.framesWithFace=0;
    this.lastVideoTime=null;
    this.lastFrameAt=performance.now();
    this.onStatus('watching');
    // Prefer a worker clock: hidden documents throttle their own timers to as
    // little as one tick per minute, which would break the 10-second rule.
    if(typeof Worker==='function'){
      try{
        this.clock??=new Worker(new URL('./attention-clock.js',import.meta.url));
        this.clock.onmessage=()=>this.tick();
        this.clock.postMessage(TICK_MS);
      }catch{this.clock=null;}
    }
    this.tick();
  }

  setBaseline(baseline){
    this.baseline=normalizeBaseline(baseline);
  }

  // Averages the raw head pose and blink measurements over `ms` while the user
  // looks at the screen normally, then stores the result as the baseline.
  async calibrate(ms=2000){
    if(!this.running)throw new Error('Turn the camera on before calibrating.');
    const samples=[];
    let last=this.lastFrame;
    let detected=false;
    const steps=Math.max(1,Math.round(ms/100));
    for(let i=0;i<steps;i++){
      await new Promise(resolve=>setTimeout(resolve,100));
      if(!this.running)break;
      const frame=this.lastFrame;
      // lastFrame changes every tick (200 ms), so skip repeats of the same frame.
      if(!frame||frame===last)continue;
      last=frame;
      if(frame.reason!=='no-face'){
        detected=true;
        if(Number.isFinite(frame.yaw)&&Number.isFinite(frame.pitch))samples.push(frame);
      }
    }
    if(!this.running)throw new Error('The camera stopped during calibration.');
    if(samples.length<5){
      if(detected)throw new Error('Face detected, but too few usable head-angle samples. Hold still and try again.');
      if(last===null)throw new Error('No video frames were analyzed. Restart the camera and try again.');
      throw new Error('No face found during calibration. Face the camera and try again.');
    }
    const avg=values=>values.reduce((sum,v)=>sum+v,0)/values.length;
    const baseline={
      yaw:avg(samples.map(f=>f.yaw)),
      pitch:avg(samples.map(f=>f.pitch)),
      blink:avg(samples.map(f=>((f.blinkLeft??0)+(f.blinkRight??0))/2)),
    };
    this.setBaseline(baseline);
    return baseline;
  }

  // Driven by the worker clock when available, otherwise by setTimeout.
  // Never requestAnimationFrame: offscreen documents are hidden.
  tick(){
    if(!this.running)return;
    const now=Date.now();
    let changed=null;
    try{
      const videoTime=this.video.currentTime;
      if(this.video.readyState>=2&&this.video.videoWidth>0&&videoTime!==this.lastVideoTime){
        const frame=classifyFrame(this.landmarker.detectForVideo(this.video,performance.now()),{},this.baseline);
        this.lastVideoTime=videoTime;
        this.lastFrameAt=performance.now();
        this.framesChecked++;
        if(frame.reason!=='no-face')this.framesWithFace++;
        this.lastFrame=frame;
        this.errors=0;
        changed=this.filter.update(frame.looking,now);
      }
    }catch(error){
      if(++this.errors>=MAX_FRAME_ERRORS){
        this.release();
        this.onStatus('error',error);
        return;
      }
    }
    if(performance.now()-this.lastFrameAt>5000){
      this.release();
      this.onStatus('error',new Error('Camera frames stopped. Restart the camera.'));
      return;
    }
    if(!this.clock)this.timer=setTimeout(()=>this.tick(),TICK_MS);
    if(changed!==null)this.onChange(changed);
    if(this.lastFrame&&now-this.lastBeat>=HEARTBEAT_MS){
      this.lastBeat=now;
      this.onChange(this.filter.present);
    }
  }

  // Releases camera and timer without reporting a status.
  release(){
    this.running=false;
    clearTimeout(this.timer);
    this.timer=null;
    this.clock?.postMessage(0);
    if(this.stream)stopTracks(this.stream);
    this.stream=null;
    if(this.video)this.video.srcObject=null;
    this.filter=new AttentionFilter();
    this.lastFrame=null;
  }

  stop(){
    this.generation++;
    this.release();
    this.onStatus('off');
  }
}
