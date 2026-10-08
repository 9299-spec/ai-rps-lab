import {STAGES,MovementCounter,inspectPose} from './movement.mjs';
const $=id=>document.getElementById(id),video=$('video'),canvas=$('skeleton'),ctx=canvas.getContext('2d');
const edges=[[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],[27,29],[28,30],[29,31],[30,32],[27,31],[28,32]];
let state='idle',resumeState='',stage=0,counter=new MovementCounter(),scores=[0,0,0],remaining=30,rest=10,prep=3;
let stream=null,worker=null,workerReady=false,inFlight=false,session=0,lastVideo=-1,latest=null,lastPoseTime=0,goodSince=0,loadTimer,frameTimer;
let previous=performance.now(),audio=null,rewardTimer;
const captions=['一伸手，星星就亮了','一开一合，护盾充能','一步一步，发现新风景'];
function overlay(text,caption){$('centerOverlay').hidden=!text;$('bigText').textContent=text||'';$('bigCaption').textContent=caption||''}
function clearDrawing(){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height)}
function fresh(){return !!latest&&performance.now()-lastPoseTime<850&&inspectPose(latest.landmarks,stage).ok}
function setStatus(text){$('status').textContent=text}
function releaseCamera(){
 session++;clearTimeout(loadTimer);clearTimeout(frameTimer);worker?.terminate();worker=null;workerReady=inFlight=false;
 stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;latest=null;lastPoseTime=goodSince=0;clearDrawing();
 $('placeholder').hidden=false;$('cameraStart').disabled=false;$('cameraStop').disabled=true;$('trackingLabel').textContent='摄像头已关闭';document.querySelector('.camera-card').classList.remove('tracked');
}
function fail(message){releaseCamera();state='error';counter.resetCycle();overlay('再试试','设备还没有准备好');$('bigText').style.fontSize='42px';setStatus(message);$('viewHint').textContent='可以重新开启摄像头';controls()}
function updateMission(){
 const s=STAGES[stage];$('missionTag').textContent='MISSION 0'+(stage+1);$('missionName').textContent=s.name;$('action').textContent=s.action;$('detail').textContent=s.detail;$('unit').textContent=s.unit;
 $('world').className='world '+s.theme;$('worldCaption').textContent=captions[stage];$('stagePill').textContent=s.icon+' 第 '+(stage+1)+' 关 · '+s.name;
 document.querySelectorAll('.route li').forEach((li,i)=>{li.classList.toggle('active',i===stage&&state!=='complete');li.classList.toggle('done',i<stage||state==='complete');li.querySelector('em').textContent=i<stage||state==='complete'?`${scores[i]} ${STAGES[i].unit}`:i===stage?'正在探索':'等待出发'});
 updateScore();
}
function updateScore(){ $('count').textContent=counter.count;$('energyFill').style.width=Math.min(counter.count/8*100,100)+'%';$('scoreNote').textContent=counter.count>=8?'充能成功，继续按自己的节奏':'每次完整动作，点亮一点能量'}
function controls(){
 const ready=fresh();$('pause').disabled=!['countdown','playing','rest','paused'].includes(state);$('pause').textContent=state==='paused'?'继续闯关':'暂停一下';
 $('start').disabled=true;
 let text='先开启摄像头';
 if(state==='loading')text='正在准备视觉模型…';
 if(state==='calibrating')text='请站好，让 AI 看清你';
 if(state==='ready'){text=ready?'开始三关冒险':'请让全身回到画面';$('start').disabled=!ready}
 if(state==='countdown')text='准备出发…';
 if(state==='playing')text='冒险进行中';
 if(state==='paused')text='已暂停，休息一会儿';
 if(state==='rest'){text=rest>0?`休息一下 · ${Math.ceil(rest)} 秒`:'我准备好了，去下一关';$('start').disabled=rest>0||!ready}
 if(state==='complete'){text='查看本次冒险记录';$('start').disabled=false}
 $('start').textContent=text;
}
function resetAdventure(){stage=0;counter=new MovementCounter(0);scores=[0,0,0];remaining=30;rest=10;prep=3;goodSince=0;$('timeLeft').textContent='30';$('bigText').style.fontSize='';overlay(null);updateMission()}
async function startCamera(){
 if(['loading','calibrating','ready','countdown','playing','paused','rest'].includes(state))return;
 releaseCamera();resetAdventure();state='loading';$('cameraStart').disabled=true;$('cameraStop').disabled=false;controls();setStatus('请允许摄像头访问。模型首次加载可能需要一些时间。');
 const mine=session;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('请在 Chrome 或 Edge 中通过 HTTPS 打开此网页。');
  let permissionTimer;
  const request=navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:false});
  request.then(s=>{if(mine!==session)s.getTracks().forEach(t=>t.stop())},()=>{});
  let acquired;
  try{acquired=await Promise.race([request,new Promise((_,reject)=>{permissionTimer=setTimeout(()=>reject(Error('摄像头等待超时，请检查浏览器的摄像头权限后重试。')),20000)})])}finally{clearTimeout(permissionTimer)}
  if(mine!==session){acquired.getTracks().forEach(t=>t.stop());return}
  stream=acquired;
  video.srcObject=stream;await video.play();if(mine!==session)return;
  stream.getVideoTracks()[0].addEventListener('ended',()=>{if(mine===session)fail('摄像头连接已中断，请重新开启。')});
  $('placeholder').hidden=true;$('trackingLabel').textContent='正在加载身体模型';setStatus('正在准备身体关键点模型。你的画面只在这台设备上处理。');
  worker=new Worker('pose-worker.js?v=1');loadTimer=setTimeout(()=>fail('模型加载超时。请检查网络，重新开启摄像头。'),60000);
  worker.onerror=()=>{if(mine===session)fail('身体识别组件加载失败，请刷新或换用 Chrome / Edge 重试。')};
  worker.onmessage=({data})=>{
   if(mine!==session)return;
   if(data.type==='error'){fail('身体识别暂不可用，请重新开启摄像头。');return}
   if(data.type==='ready'){clearTimeout(loadTimer);workerReady=true;state='calibrating';lastVideo=-1;setStatus('模型已就绪。面向摄像头，让头顶、双手和双脚都在画面内，站稳一会儿。');controls()}
   if(data.type==='result'){
    inFlight=false;clearTimeout(frameTimer);if(data.session!==session||document.hidden)return;
    latest=data;lastPoseTime=data.time;
    const q=inspectPose(data.landmarks,stage),ok=q.ok&&performance.now()-data.time<850;
    $('trackingLabel').textContent=ok?'● 身体关键点已锁定':'寻找清晰的身体位置';document.querySelector('.camera-card').classList.toggle('tracked',ok);
    if(state==='calibrating'){
     if(ok){if(!goodSince)goodSince=data.time;if(data.time-goodSince>1000){state='ready';setStatus('准备好了！点击“开始三关冒险”，跟随右侧提示活动。')}}else goodSince=0;
    }
    if(state==='playing'){
     const result=counter.update(ok?data.landmarks:null,data.time);
     $('viewHint').textContent=result.hint;
     if(result.counted){scores[stage]=counter.count;updateScore();reward()}
    }else if(['calibrating','ready'].includes(state))$('viewHint').textContent=q.message;
    draw();controls();
   }
  };
  worker.postMessage({type:'init'});
 }catch(e){if(mine!==session)return;const names={NotAllowedError:'摄像头权限未开启。请点击地址栏的权限图标，允许摄像头后重试。',NotFoundError:'没有找到摄像头，请连接设备后重试。',NotReadableError:'摄像头可能被其他软件占用，请关闭占用它的软件后重试。'};fail(names[e.name]||e.message)}
}
function draw(){
 clearDrawing();if(!$('showPoints').checked||!latest?.landmarks||performance.now()-lastPoseTime>850)return;
 const box=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(box.width*dpr);canvas.height=Math.round(box.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
 const scale=Math.min(box.width/latest.width,box.height/latest.height),w=latest.width*scale,h=latest.height*scale,ox=(box.width-w)/2,oy=(box.height-h)/2,p=latest.landmarks;
 const xy=i=>[ox+(1-p[i].x)*w,oy+p[i].y*h],visible=i=>p[i]&&p[i].visibility>=.55&&p[i].x>=0&&p[i].x<=1&&p[i].y>=0&&p[i].y<=1;
 ctx.lineWidth=2.5;ctx.strokeStyle='#8cf2d2';ctx.shadowColor='#10203b';ctx.shadowBlur=3;
 for(const[a,b]of edges){if(!visible(a)||!visible(b))continue;ctx.beginPath();ctx.moveTo(...xy(a));ctx.lineTo(...xy(b));ctx.stroke()}
 p.forEach((_,i)=>{if(!visible(i))return;ctx.beginPath();ctx.arc(...xy(i),i<11?2.3:4,0,Math.PI*2);ctx.fillStyle=[15,16,25,26].includes(i)?'#ffdb78':'#e3fff7';ctx.fill()});
 for(const[i,label]of [[11,'肩'],[16,'手腕'],[24,'髋'],[25,'膝'],[28,'脚踝']]){if(!visible(i))continue;const[x,y]=xy(i);ctx.font='bold 10px sans-serif';ctx.lineWidth=3;ctx.strokeStyle='#163849';ctx.strokeText(label,x+8,y-7);ctx.fillStyle='#fff';ctx.fillText(label,x+8,y-7)}
}
function reward(){
 $('reward').textContent=STAGES[stage].icon+' +1';$('reward').classList.remove('pop');void $('reward').offsetWidth;$('reward').classList.add('pop');$('world').classList.add('celebrate');
 clearTimeout(rewardTimer);rewardTimer=setTimeout(()=>{$('world').classList.remove('celebrate');$('reward').textContent=''},850);
 if($('sound').checked&&audio){try{const o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);o.frequency.setValueAtTime(660,audio.currentTime);o.frequency.exponentialRampToValueAtTime(880,audio.currentTime+.12);g.gain.setValueAtTime(.045,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.25);o.start();o.stop(audio.currentTime+.26)}catch{}}
}
function beginCountdown(){state='countdown';prep=3;remaining=30;counter.resetCycle();overlay('3','站稳啦，马上出发');$('bigText').style.fontSize='';$('viewHint').textContent=STAGES[stage].action;document.querySelector('.play-layout').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});controls()}
function finishStage(){
 scores[stage]=counter.count;
 if(stage<2){state='rest';rest=10;overlay('休息一下','放松肩膀，按自己的节奏呼吸');$('bigText').style.fontSize='38px';$('viewHint').textContent='休息后，点击右侧按钮进入下一关';setStatus('这一关完成了！休息结束后可以继续，也可以多休息一会儿。')}
 else {state='complete';releaseCamera();updateMission();overlay(null);$('viewHint').textContent='冒险完成，摄像头已关闭';setStatus('本次游戏结束，摄像头已关闭。动作次数只保留在本页面。');showResults()}
 controls();
}
function showResults(){ $('resultCounts').replaceChildren(...STAGES.map((s,i)=>{const div=document.createElement('div'),b=document.createElement('b'),span=document.createElement('span');b.textContent=scores[i];span.textContent=s.unit;div.append(b,span);return div}));if(!$('results').open)$('results').showModal()}
function pause(){if(['countdown','playing','rest'].includes(state)){resumeState=state;state='paused';counter.resetCycle();overlay('已暂停','休息好了，再点击“继续闯关”');$('bigText').style.fontSize='42px';$('viewHint').textContent='暂停期间不会计时或计数'}else if(state==='paused'){state=resumeState;counter.resetCycle();if(state==='rest')overlay('休息一下','放松肩膀，按自己的节奏呼吸');else overlay(null)}controls()}
async function capture(){
 try{
  if(workerReady&&!inFlight&&stream&&video.readyState>=2&&!document.hidden&&video.currentTime!==lastVideo){
   inFlight=true;lastVideo=video.currentTime;const mine=session,bitmap=await createImageBitmap(video);
   if(mine!==session||!worker){bitmap.close();return}
   frameTimer=setTimeout(()=>{if(mine===session)fail('这台设备处理画面较慢或已停止响应，请重新开启摄像头。')},10000);
   worker.postMessage({type:'frame',bitmap,session:mine,time:performance.now()},[bitmap]);
  }
 }catch(e){if(stream)fail('无法读取摄像头画面，请重新开启。')}
 finally{setTimeout(capture,110)}
}
function tick(now){
 const dt=Math.min((now-previous)/1000,.25);previous=now;const tracked=fresh();
 if(!tracked&&latest){clearDrawing();document.querySelector('.camera-card').classList.remove('tracked')}
 if(['playing','countdown'].includes(state)){
  if(!tracked){counter.resetCycle();overlay('等等我','AI 没看清你，计时已经暂停');$('bigText').style.fontSize='38px';$('viewHint').textContent=latest&&performance.now()-lastPoseTime<850?inspectPose(latest.landmarks,stage).message:'请让全身清晰地回到画面'}
  else if(state==='countdown'){prep-=dt;$('bigText').style.fontSize='80px';overlay(String(Math.max(1,Math.ceil(prep))),'站稳啦，马上出发');if(prep<=0){state='playing';counter.resetCycle();overlay(null);setStatus('完整做一次“抬起、放下”才会记一次。看不清身体时，计时会自动暂停。')}}
  else {overlay(null);remaining=Math.max(0,remaining-dt);$('timeLeft').textContent=Math.ceil(remaining);if(remaining<=0)finishStage()}
 }else if(state==='rest'){rest=Math.max(0,rest-dt);$('timeLeft').textContent=Math.ceil(rest);if(rest<=0)$('bigCaption').textContent='准备好了，就去下一关；也可以继续休息'}
 if(state==='ready'&&!tracked)$('viewHint').textContent='请让全身清晰地回到画面';
 controls();requestAnimationFrame(tick);
}
$('cameraStart').onclick=startCamera;
$('cameraStop').onclick=()=>{releaseCamera();state='idle';counter.resetCycle();overlay(null);$('viewHint').textContent='重新开启摄像头，将开始一次新的冒险';setStatus('摄像头已关闭。本次冒险已结束，重新开启会重置记录。');controls()};
$('start').onclick=()=>{if(state==='complete'){showResults();return}if(!fresh())return;if(state==='ready')beginCountdown();else if(state==='rest'&&rest<=0){stage++;counter=new MovementCounter(stage);updateMission();beginCountdown()}};
$('pause').onclick=pause;$('showPoints').onchange=draw;
$('sound').onchange=()=>{if($('sound').checked){try{audio??=new(window.AudioContext||window.webkitAudioContext)();audio.resume()}catch{$('sound').checked=false}}};
$('again').onclick=()=>{$('results').close();state='idle';startCamera()};$('closeResults').onclick=()=>$('results').close();
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(['countdown','playing','rest'].includes(state))pause();counter.resetCycle();goodSince=0;lastPoseTime=0;clearDrawing()}});
window.addEventListener('pagehide',()=>{releaseCamera();audio?.close()});new ResizeObserver(draw).observe(canvas);
updateMission();controls();capture();requestAnimationFrame(tick);
