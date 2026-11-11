// Tick source for the eye-tracking loop. Timers in hidden pages (like the
// offscreen document) are heavily throttled by Chrome; worker timers are not.
let timer=null;
self.onmessage=({data})=>{
  clearInterval(timer);timer=null;
  if(Number(data)>0)timer=setInterval(()=>self.postMessage('tick'),Number(data));
};
