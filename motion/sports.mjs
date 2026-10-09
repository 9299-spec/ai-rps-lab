import {BODY,quality,features,trainPoses,predictPose,RepCounter,schedule,ranked} from './sports-core.mjs?v=3';
import {WALL_POSES,wallSequence,matchWall} from './wall-poses.mjs?v=3';
const $=id=>document.getElementById(id),video=$('video'),canvas=$('skeleton'),ctx=canvas.getContext('2d');
const titles={wall:'墙来了',knees:'高抬腿计数赛',jacks:'开合跳计数赛'};
const descriptions={wall:'12 种身体造型，墙不断逼近。摆对并保持片刻，立刻得分穿墙！',knees:'左右交替，抬膝到位再落脚。规定时间内，有效次数更多者获胜。',jacks:'双臂与双脚一起打开，再一起合拢。完成一个循环，计 1 次。'};
const links=[[0,1],[0,2],[2,4],[1,3],[3,5],[0,6],[1,7],[6,7],[6,8],[8,10],[7,9],[9,11]];
const groups=[{name:'下一个',samples:[]},{name:'暂停 / 继续',samples:[]},{name:'不操作',samples:[]}];
let setNumber=0,wallTransition=0,wallFit={ok:false,fit:0},skillArmed=false,skillIndex=-1,skillSince=0,skillLast=0;
const examples=[[-.43,-1,.43,-1,-.65,-.5,.65,-.5,.15,-.6,-.15,-.6,-.28,0,.28,0,-.28,.85,.28,.85,-.28,1.7,.28,1.7],[-.43,-1,.43,-1,-.65,-.8,.65,-.8,-.25,-1.35,.25,-1.35,-.28,0,.28,0,-.28,.85,.28,.85,-.28,1.7,.28,1.7],[-.43,-1,.43,-1,-.5,-.5,.5,-.5,-.5,0,.5,0,-.28,0,.28,0,-.28,.85,.28,.85,-.28,1.7,.28,1.7]];
let game='wall',model=null,version=0,rows=[],rowId=0,lastResult=null,captureJob=null;
let state='idle',resumeState='',match=null,remaining=30,prep=3,score=0,wallIndex=0,wallElapsed=0,matchedFor=0,lastMatchTime=null;
let counter=new RepCounter('knees'),prediction={index:-1,label:'还没有训练'},practice=0;
let stream=null,worker=null,ready=false,inFlight=false,session=0,lastVideo=-1,latest=null,goodSince=0,loadTimer,frameTimer;
let previous=performance.now(),audio=null,rewardTimer,controlsSignature='';
const active=()=>['countdown','playing','paused'].includes(state);
const fresh=()=>!!latest&&performance.now()-latest.time<800&&quality(latest.landmarks,game).ok;
const groupKey=(g=game,seconds=Number($('duration').value),v=model?.version??0,demo=$('showDemo').checked)=>`${g}|${seconds}|${g==='wall'?setNumber:0}|${g==='wall'?Number(demo):0}|${g==='wall'&&$('useSkills').checked?v:0}`;
function status(s){$('status').textContent=s}
function overlay(title='',caption=''){$('overlay').hidden=!title;$('overlayTitle').textContent=title;$('overlayCaption').textContent=caption}
function glow(text){$('reward').textContent=text;$('reward').classList.remove('pop');void $('reward').offsetWidth;$('reward').classList.add('pop');clearTimeout(rewardTimer);rewardTimer=setTimeout(()=>$('reward').textContent='',950);if($('sound').checked&&audio){const o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);o.frequency.value=740;g.gain.setValueAtTime(.04,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.22);o.start();o.stop(audio.currentTime+.24)}}
function targetIndex(){const seq=match?.sequence||wallSequence(setNumber);return seq[wallIndex%seq.length]}
function wallLimit(){return Math.max(2.8,5-wallIndex*.18)}
function drawFigure(c,v,wall=false){
 const g=c.getContext('2d'),w=c.width,h=c.height;g.clearRect(0,0,w,h);if(!v)return;
 const xs=v.filter((_,i)=>i%2===0),ys=v.filter((_,i)=>i%2===1),minx=Math.min(...xs),maxx=Math.max(...xs),miny=Math.min(-1.5,...ys)-.3,maxy=Math.max(...ys);
 const s=Math.min((w-30)/(maxx-minx+.4),(h-22)/(maxy-miny+.3)),x0=w/2+(minx+maxx)/2*s,y0=10-miny*s;
 const pt=i=>[x0-v[i*2]*s,y0+v[i*2+1]*s];
 g.lineCap='round';g.lineJoin='round';
 function lines(color,width){g.strokeStyle=color;g.lineWidth=width;for(const[a,b]of links){g.beginPath();g.moveTo(...pt(a));g.lineTo(...pt(b));g.stroke()}}
 if(wall)lines('#141b35b0',Math.max(22,s*.22));lines(wall?'#ffe7a5bb':'#9275e6',wall?4:5);
 const neck=[(pt(0)[0]+pt(1)[0])/2,(pt(0)[1]+pt(1)[1])/2];g.beginPath();g.arc(neck[0],neck[1]-.31*s,.16*s,0,Math.PI*2);g.strokeStyle=wall?'#ffe7a5bb':'#9275e6';g.lineWidth=wall?4:4;g.stroke();
 for(let i=0;i<BODY.length;i++){g.beginPath();g.arc(...pt(i),wall?4:3,0,Math.PI*2);g.fillStyle=wall?'#ffedbc':'#b5a1ef';g.fill()}
}
function setTarget(){const target=WALL_POSES[targetIndex()];$('targetName').textContent=target.name;drawFigure($('targetShape'),target.vector);$('targetShape').style.visibility=$('showDemo').checked?'visible':'hidden';$('wallShape').width=600;$('wallShape').height=450;drawFigure($('wallShape'),$('showDemo').checked?target.vector:null,true);$('wallName').textContent=target.name;document.querySelector('.wall-frame').classList.remove('matched','pass','crash','skip');$('wallPressure').textContent='下一堵墙正在靠近';}
function resolveWall(kind){if(wallTransition>0)return;if(kind==='pass'){score++;$('score').textContent=score;glow('穿墙成功 +1')}else if(kind==='skip')glow('已跳过 · 不计分');else glow('哎呀，撞墙了！下一堵加油');wallTransition=.7;matchedFor=0;lastMatchTime=null;document.querySelector('.wall-frame').classList.add(kind);$('wallPressure').textContent=kind==='pass'?'漂亮！下一堵马上来':kind==='skip'?'下一堵准备好了':'调整姿势，再来！';}
function readSkill(data,ok){
 const now=data.time;if(!model||!$('useSkills').checked||!active()||state==='countdown'||!ok){skillArmed=false;skillIndex=-1;skillSince=now;return}
 const i=prediction.index;if(i!==skillIndex){skillIndex=i;skillSince=now}
 if(i===2&&now-skillSince>=400)skillArmed=true;
 if(!skillArmed||i<0||i===2||now-skillSince<900||now-skillLast<2200)return;
 skillArmed=false;skillLast=now;
 if(i===0&&state==='playing'&&wallTransition<=0)resolveWall('skip');
 if(i===1&&['playing','paused'].includes(state))pause();
 $('skillStatus').textContent='指令已执行。回到“不操作”姿势后，可再次发出指令。';
}

function board(){
 const key=groupKey(),list=ranked(rows,key);$('board').replaceChildren();
 $('boardGroup').textContent=`${titles[game]} · ${$('duration').value} 秒`+(game==='wall'?` · 题组 ${setNumber+1} · ${$('showDemo').checked?'显示示范':'记忆模式'} · ${$('useSkills').checked?'手势操作模型 '+(model?.version??'未训练'):'按钮操作'}`:' · 统一动作规则');
 if(!list.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.className='empty';td.textContent='这一组还没有成绩。先试做，再开始第一场比赛。';tr.append(td);$('board').append(tr);return}
 for(const row of list){const tr=document.createElement('tr');for(const text of [row.rank,row.player,`${row.score} ${row.game==='wall'?'堵墙':'次'}`,`${row.duration} 秒`]){const td=document.createElement('td');td.textContent=text;tr.append(td)}if(row.correction){const small=document.createElement('small');small.textContent=`老师更正：${row.original} → ${row.score}；${row.correction}`;tr.children[2].append(small)}$('board').append(tr)}
}
function controls(){
 const locked=active(),hasCamera=!!stream,ok=fresh(),canTrain=groups.every(g=>g.samples.length>=8);
 const sig=[state,game,ok,hasCamera,ready,!!captureJob,!!model,canTrain,groups.map(g=>g.samples.length).join(),$('player').value.trim(),$('useSkills').checked].join('|');if(sig===controlsSignature)return;controlsSignature=sig;
 document.querySelectorAll('[data-game]').forEach(b=>{b.disabled=locked||!!captureJob;b.setAttribute('aria-pressed',String(b.dataset.game===game))});
 for(const id of ['player','duration','showDemo','useSkills','newSet'])$(id).disabled=locked||!!captureJob;
 $('cameraStart').disabled=hasCamera||state==='loading';$('cameraStop').disabled=!hasCamera&&state!=='loading';
 $('pause').disabled=!locked;$('pause').textContent=state==='paused'?'继续比赛':'暂停';$('end').disabled=!locked;
 $('skipWall').hidden=game!=='wall'||!locked;$('skipWall').disabled=state!=='playing';$('newSet').hidden=game!=='wall';
 $('train').disabled=locked||!!captureJob||!canTrain;
 groups.forEach((g,i)=>{const card=$('poseCards').children[i];card.querySelector('input').disabled=true;card.querySelector('[data-capture]').disabled=locked||!!captureJob||!ok||!ready||g.samples.length>=60;card.querySelector('[data-clear]').disabled=locked||!!captureJob||!g.samples.length});
 $('clearScores').disabled=locked||!rows.length;
 let label='开始比赛',disabled=false;
 if(state==='loading'){label='正在准备摄像头与模型…';disabled=true}
 else if(!hasCamera||!ready){label='先开启摄像头';disabled=true}
 else if(locked){label=state==='paused'?'比赛已暂停':'比赛进行中';disabled=true}
 else if(captureJob){label='正在采集训练样本';disabled=true}
 else if(game==='wall'&&$('useSkills').checked&&!model){label='先训练操作技能，或关闭手势操作';disabled=true}
 else if(!ok||state==='calibrating'){label='请让全身清晰入镜';disabled=true}
 else if(!$('player').value.trim()){label='填写选手姓名后开始';disabled=true}
 $('start').textContent=label;$('start').disabled=disabled;
}
function invalidate(){model=null;prediction={index:-1,label:'样本已更新，请重新训练'};$('modelBadge').textContent='等待重新训练';setTarget();board();controlsSignature='';controls()}
function renderCards(){
 $('poseCards').replaceChildren();groups.forEach((g,i)=>{
 const card=document.createElement('article');card.className='pose-card';
 card.innerHTML=`<div class="sample-header"><span>姿势 0${i+1}</span><b data-samples>0 / 60 个样本</b></div><input maxlength="12" aria-label="姿势 ${i+1} 的名字"><p>为这个操作指令设计一个明显不同的姿势。指令名称固定，姿势由你决定。</p><div class="sample-preview"><canvas width="200" height="170"></canvas></div><div class="actions"><button class="secondary" data-capture="${i}">准备 3 秒 · 连拍 10 个</button><button class="quiet" data-clear="${i}">清空重教</button></div>`;
 card.querySelector('p').textContent=['示例：双手交叉放在胸前，跳过当前墙，不加分。也可自行设计。','示例：双手靠近头部，用于暂停或继续。也可自行设计。','示例：双手自然放下。回到这个姿势，才可再次发出指令。'][i];card.querySelector('input').value=g.name;card.querySelector('input').onchange=e=>{if(active()||captureJob)return;g.name=e.target.value.trim()||`姿势 ${i+1}`;e.target.value=g.name;invalidate()};
 card.querySelector('[data-capture]').onclick=()=>startCapture(i);
 card.querySelector('[data-clear]').onclick=()=>{if(active()||captureJob)return;g.samples=[];invalidate();updateCards();$('trainingStatus').textContent='这一类已清空。摆出新的姿势，再采集并重新训练。'};
 $('poseCards').append(card);drawFigure(card.querySelector('canvas'),examples[i]);
 });updateCards();
}
function updateCards(){groups.forEach((g,i)=>{const card=$('poseCards').children[i];card.querySelector('[data-samples]').textContent=`${g.samples.length} / 60 个样本`;drawFigure(card.querySelector('canvas'),g.samples.at(-1)||examples[i])});controlsSignature='';controls()}
function startCapture(i){if(active()||captureJob||!fresh())return;captureJob={i,start:performance.now(),last:0,count:0};$('stopCapture').hidden=false;$('trainingStatus').textContent='3 秒后开始。请摆好姿势，采集中可稍微变化距离和幅度。';controls();document.querySelector('.arena-layout').scrollIntoView({block:'start',behavior:'smooth'})}
function stopCapture(message){captureJob=null;$('stopCapture').hidden=true;overlay();$('trainingStatus').textContent=message;updateCards()}
function collect(data){
 if(!captureJob)return;const job=captureJob,elapsed=performance.now()-job.start;
 if(elapsed<3000)return;
 if(!fresh()||data.time-job.last<480)return;
 const v=features(data.landmarks,data.width/data.height);if(!v)return;
 if(model)invalidate();groups[job.i].samples.push(v);job.count++;job.last=data.time;updateCards();
 $('trainingStatus').textContent=`${groups[job.i].name}：本次已采集 ${job.count} / 10 个。可以换同学补充样本。`;
 if(job.count>=10||groups[job.i].samples.length>=60)stopCapture('采集完成。为同一指令补充不同人的样本。三类满 8 个即可训练操作技能。');
}
function train(){
 if(active()||captureJob)return;
 if(new Set(groups.map(g=>g.name)).size!==groups.length){$('trainingStatus').textContent='三个操作技能必须有不同的名字。';return}
 try{const next=trainPoses(groups,version+1);model=next;version++;$('modelBadge').textContent=`模型 ${version} · 已训练`;$('trainingStatus').textContent=next.warnings.length?next.warnings.join('；'):'技能训练完成！先试做检查，再勾选“使用训练的手势操作”。这些技能控制游戏，不是墙的答案。';prediction={index:-1,label:'请做一个学过的姿势'};setTarget();board();controlsSignature='';controls()}catch(e){$('trainingStatus').textContent=e.message}
}
function clearSkeleton(){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height)}
function drawSkeleton(){
 clearSkeleton();if(!$('points').checked||!latest?.landmarks||performance.now()-latest.time>800)return;
 const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
 const scale=Math.min(rect.width/latest.width,rect.height/latest.height),w=latest.width*scale,h=latest.height*scale,ox=(rect.width-w)/2,oy=(rect.height-h)/2,p=latest.landmarks;
 const xy=i=>[ox+(1-p[i].x)*w,oy+p[i].y*h],valid=i=>p[i]?.visibility>=.55&&p[i].x>=0&&p[i].x<=1&&p[i].y>=0&&p[i].y<=1;
 ctx.lineWidth=3;ctx.strokeStyle=counter.phase==='raised'&&game!=='wall'?'#ffe385':'#88efd0';ctx.shadowColor='#142139';ctx.shadowBlur=3;
 for(const[a,b]of links.map(([a,b])=>[BODY[a],BODY[b]])){if(!valid(a)||!valid(b))continue;ctx.beginPath();ctx.moveTo(...xy(a));ctx.lineTo(...xy(b));ctx.stroke()}
 p.forEach((_,i)=>{if(!valid(i))return;ctx.beginPath();ctx.arc(...xy(i),i<11?2:4,0,Math.PI*2);ctx.fillStyle=[15,16,25,26].includes(i)?'#ffe28e':'#effff9';ctx.fill()});
 if(game==='knees'&&valid(23)&&valid(24)){const y=(xy(23)[1]+xy(24)[1])/2+.28*((p[23].y+p[24].y-p[11].y-p[12].y)/2)*h;ctx.setLineDash([6,5]);ctx.strokeStyle='#ffd578';ctx.beginPath();ctx.moveTo(rect.width*.25,y);ctx.lineTo(rect.width*.75,y);ctx.stroke();ctx.setLineDash([]);ctx.font='11px sans-serif';ctx.fillStyle='#ffe6a3';ctx.fillText('抬膝目标线',rect.width*.25,y-8)}
}
function release(){session++;clearTimeout(loadTimer);clearTimeout(frameTimer);worker?.terminate();worker=null;ready=inFlight=false;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;latest=null;goodSince=0;clearSkeleton();$('placeholder').hidden=false;$('tracking').textContent='摄像头已关闭';controlsSignature=''}
function fail(message){release();if(captureJob)stopCapture('采集已停止，已采到的样本保留。');match=null;state='idle';counter.reset();$('approachingWall').hidden=true;overlay('暂时无法识别','请检查设备后重新开启');status(message);controls()}
async function camera(){
 if(stream||state==='loading')return;release();state='loading';overlay();status('请允许摄像头访问。首次加载身体模型可能稍慢。');controls();const mine=session;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('请通过 HTTPS 在 Chrome 或 Edge 中打开网页。');
  const request=navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:false});
  request.then(s=>{if(mine!==session)s.getTracks().forEach(t=>t.stop())},()=>{});let timer,s;
  try{s=await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('等待摄像头超时，请检查浏览器权限后重试。')),20000)})])}finally{clearTimeout(timer)}
  if(mine!==session){s.getTracks().forEach(t=>t.stop());return}stream=s;video.srcObject=s;await video.play();if(mine!==session)return;
  s.getVideoTracks()[0].addEventListener('ended',()=>{if(mine===session)fail('摄像头已断开；本轮不计入排行榜，请重新连接。')});
  $('placeholder').hidden=true;$('tracking').textContent='正在加载身体模型';worker=new Worker('pose-worker.js?v=2');loadTimer=setTimeout(()=>fail('模型加载超时，请检查网络后重试。'),60000);
  worker.onerror=()=>{if(mine===session)fail('身体模型启动失败，请刷新或换用 Chrome / Edge。')};
  worker.onmessage=({data})=>{
   if(mine!==session)return;
   if(data.type==='error'){fail('识别组件遇到问题，请重新开启摄像头。');return}
   if(data.type==='ready'){clearTimeout(loadTimer);ready=true;state='calibrating';lastVideo=-1;status('模型就绪。面向摄像头，让全身清楚入镜并站稳。');controls()}
   if(data.type==='result'){
    clearTimeout(frameTimer);inFlight=false;if(data.session!==session||document.hidden)return;latest=data;const ok=fresh(),q=quality(data.landmarks,game);
    $('tracking').textContent=ok?'● 身体关键点已锁定':'寻找清晰的身体';
    if(state==='calibrating'){if(ok){if(!goodSince)goodSince=data.time;if(data.time-goodSince>800){state='ready';status('准备好了。可先试做，或采集姿势样本。正式比赛前请填写选手姓名。')}}else goodSince=0}
    if(captureJob)collect(data);
    if(game==='wall'){
     const vector=ok?features(data.landmarks,data.width/data.height):null;
     prediction=ok?predictPose(model,vector):{index:-1,label:'看不清身体'};
     $('skillStatus').textContent=model?`操作识别：${prediction.label} · ${skillArmed?'可发出指令':'先保持“不操作”姿势，再发指令'}`:'可直接比赛；训练操作技能后，可用身体发出“下一个”等指令。';
     readSkill(data,ok);
     wallFit=matchWall(vector,WALL_POSES[targetIndex()]);
     $('prediction').textContent=ok?`姿势贴合 ${wallFit.fit}%`:'看不清身体';
     if(state==='playing'&&wallTransition<=0){
      const correct=ok&&wallFit.ok;
      if(correct&&lastMatchTime!==null&&data.time-lastMatchTime<800)matchedFor+=(data.time-lastMatchTime)/1000;else matchedFor=0;
      lastMatchTime=correct?data.time:null;document.querySelector('.wall-frame').classList.toggle('matched',correct);
      $('hint').textContent=`${WALL_POSES[targetIndex()].name} · ${wallFit.hint}`;
      if(correct&&matchedFor>=.45)resolveWall('pass');
     }else if(!captureJob&&state!=='paused')$('hint').textContent=ok?wallFit.hint:q.hint;
    }else if(['ready','playing'].includes(state)){
     const result=counter.update(ok?data.landmarks:null,data.time);$('hint').textContent=result.hint;$('prediction').textContent=result.atTarget?'动作到位 · 等待回位':result.hint;
     if(result.counted){if(state==='playing'){score=counter.count;$('score').textContent=score;glow('+1')}else{practice++;$('score').textContent=practice;$('scoreDescription').textContent='试做次数 · 不计入排行榜'}}
    }
    drawSkeleton();controls();
   }
  };worker.postMessage({type:'init'});
 }catch(e){if(mine===session)fail(({NotAllowedError:'请在浏览器地址栏允许摄像头，然后重试。',NotFoundError:'没有找到摄像头，请连接设备。',NotReadableError:'摄像头可能被其他软件占用，请关闭占用它的软件。'})[e.name]||e.message)}
}
function selectGame(next){
 if(active()||captureJob)return;game=next;counter=new RepCounter(game);practice=score=0;match=null;wallIndex=0;wallTransition=0;$('score').textContent='0';remaining=Number($('duration').value);$('clock').textContent=remaining;$('progressFill').style.width='0%';$('gameTitle').textContent=titles[game];$('gameDescription').textContent=descriptions[game];$('training').hidden=game!=='wall';$('targetBox').hidden=game!=='wall';$('repRules').hidden=game==='wall';$('demoLabel').hidden=game!=='wall';$('approachingWall').hidden=true;$('scoreUnit').textContent=game==='wall'?'堵墙':'次';$('readoutLabel').textContent=game==='wall'?'与目标姿势对比':'动作检查';$('prediction').textContent=game==='wall'?'等待身体入镜':'先双脚落地，试做一次';$('modeBadge').textContent=`${titles[game]} · 练习区`;$('scoreDescription').textContent=game==='wall'?'摆对立即 +1，墙会逐渐加速':'先试做 · 比赛开始时清零';
 $('repRules').innerHTML=game==='knees'?'<b>左右交替抬膝</b><br>膝盖接近髋部 → 落脚 = 1 次<br>黄线是抬膝目标，身体比例自动适配。':'<b>双臂和双脚一起配合</b><br>举高双臂、双脚打开 → 放下双臂、双脚合拢 = 1 次<br>不单独判断腾空高度。';
 if(ready)state='ready';setTarget();board();overlay();controlsSignature='';controls();
}
function startMatch(){
 if(active()||captureJob||!fresh()||!$('player').value.trim()||(game==='wall'&&$('useSkills').checked&&!model))return;
 const duration=Number($('duration').value);match={game,player:$('player').value.trim(),duration,version:model?.version??0,demo:$('showDemo').checked,key:groupKey(),sequence:game==='wall'?wallSequence(setNumber):[]};
 state='countdown';prep=3;remaining=duration;score=wallIndex=wallElapsed=matchedFor=wallTransition=0;skillArmed=false;skillIndex=-1;lastMatchTime=null;counter=new RepCounter(game);$('score').textContent='0';$('clock').textContent=duration;$('scoreDescription').textContent='正式比赛 · 完成后自动入榜';$('modeBadge').textContent=`${match.player} · ${titles[game]}`;setTarget();overlay('3','站稳啦，比赛马上开始');controlsSignature='';controls();document.querySelector('.arena-layout').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})
}
function resultView(){
 if(!lastResult)return;const r=lastResult;$('resultTitle').textContent='本轮完成！';$('resultPlayer').textContent=`${r.player} · ${titles[r.game]} · ${r.duration} 秒`;$('resultScore').textContent=`${r.score} ${r.game==='wall'?'堵墙':'次'}`;$('resultDetail').textContent=r.correction?'已由老师更正成绩，排行榜已同步更新。':'成绩已加入对应组别的排行榜。休息一下，再换下一位选手。';$('correctScore').value=r.score;$('correctScore').max=Math.floor(r.duration*4);$('correctReason').value='';$('correctionStatus').textContent='';
}
function finish(){
 const record={...match,score,original:score,id:++rowId,correction:''};rows.push(record);lastResult=record;state='result';match=null;$('approachingWall').hidden=true;overlay('本轮完成',`${record.player} · ${score} ${game==='wall'?'堵墙':'次'}`);counter.reset();board();resultView();$('result').showModal();status('本轮完成。摄像头为下一位保留，结束课堂时请点“关闭”。');controlsSignature='';controls();
}
function cancelRound(){if(!active())return;match=null;state=ready?'ready':'idle';counter=new RepCounter(game);practice=score=0;$('score').textContent='0';$('approachingWall').hidden=true;overlay();$('scoreDescription').textContent='本轮已结束，未加入排行榜';$('clock').textContent=$('duration').value;controlsSignature='';controls()}
function pause(){if(['playing','countdown'].includes(state)){resumeState=state;state='paused';counter.reset();matchedFor=0;lastMatchTime=null;overlay('已暂停','休息好了，点击“继续比赛”')}else if(state==='paused'){state=resumeState;counter.reset();overlay()}controlsSignature='';controls()}
async function cameraLoop(){
 try{if(ready&&!inFlight&&stream&&video.readyState>=2&&!document.hidden&&video.currentTime!==lastVideo){inFlight=true;lastVideo=video.currentTime;const mine=session,bitmap=await createImageBitmap(video);if(mine!==session||!worker){bitmap.close();return}frameTimer=setTimeout(()=>{if(mine===session)fail('画面处理已停止响应，请重新开启摄像头；本轮不入榜。')},10000);worker.postMessage({type:'frame',bitmap,session:mine,time:performance.now()},[bitmap])}}
 catch{if(stream)fail('无法读取摄像头，请重新开启。')}
 finally{setTimeout(cameraLoop,90)}
}
function tick(now){
 const dt=Math.min(Math.max(0,(now-previous)/1000),.25);previous=now;const ok=fresh();
 $('approachingWall').classList.toggle('stopped',state!=='playing'||!ok);
 if(!ok){clearSkeleton();skillArmed=false;skillIndex=-1;if(state==='playing'||state==='countdown'){counter.reset();matchedFor=0;lastMatchTime=null}}
 if(captureJob){const elapsed=performance.now()-captureJob.start;if(elapsed<3000)overlay(String(Math.ceil((3000-elapsed)/1000)),`准备：${groups[captureJob.i].name}`);else if(elapsed>30000)stopCapture('采集已结束。看不清的画面没有加入样本，可调整位置后继续。');else overlay('', '');if(captureJob&&elapsed>=3000){$('hint').textContent=ok?`正在采集“${groups[captureJob.i].name}” · ${captureJob.count} / 10 个`:'看不清身体，暂不采样，请调整位置';if(!ok)$('trainingStatus').textContent='身体不清楚，暂不采样。请让全身回到画面。'}}
 if(state==='countdown'||state==='playing'){
  if(!ok){overlay('等等我','看不清身体，计时和计数已暂停');$('hint').textContent=latest&&performance.now()-latest.time<800?quality(latest.landmarks,game).hint:'请让全身清晰地回到画面'}
  else if(state==='countdown'){prep-=dt;overlay(String(Math.max(1,Math.ceil(prep))),'站稳啦，比赛马上开始');if(prep<=0){state='playing';counter.reset();matchedFor=0;lastMatchTime=null;overlay();$('approachingWall').hidden=game!=='wall';status('比赛开始！动作到位再回位才计数。看不清身体时自动暂停。')}}
  else{
   overlay();const step=Math.min(dt,remaining);remaining=Math.max(0,remaining-step);$('clock').textContent=Math.ceil(remaining);$('progressFill').style.width=(1-remaining/match.duration)*100+'%';
   if(game==='wall'){
    if(wallTransition>0){wallTransition=Math.max(0,wallTransition-step);if(wallTransition===0){wallIndex++;wallElapsed=0;matchedFor=0;lastMatchTime=null;setTarget()}}
    else {
     wallElapsed+=step;const limit=wallLimit(),pressure=Math.min(wallElapsed/limit,1),left=Math.max(0,limit-wallElapsed);
     $('wallTime').textContent=`第 ${wallIndex+1} 堵 · ${left.toFixed(1)} 秒后撞墙`;
     $('wallPressure').textContent=left<1.5?`快！还有 ${left.toFixed(1)} 秒`:`正在逼近 · ${left.toFixed(1)} 秒`;
     $('approachingWall').style.setProperty('--wall-scale',String(.22+.92*pressure*pressure));$('approachingWall').style.setProperty('--wall-opacity',String(.25+.7*pressure));
     $('approachingWall').classList.toggle('urgent',left<1.5);
     if(wallElapsed>=limit)resolveWall('crash');
    }
   }
   if(remaining<=1e-7)finish();
  }
 }
 controls();requestAnimationFrame(tick);
}
document.querySelectorAll('[data-game]').forEach(b=>b.onclick=()=>selectGame(b.dataset.game));
$('cameraStart').onclick=camera;$('cameraStop').onclick=()=>{if(active())cancelRound();if(captureJob)stopCapture('采集已停止，已有样本保留。');release();state='idle';overlay();status('摄像头已关闭，样本和成绩仍保留在本页。');controls()};
$('skipWall').onclick=()=>{if(state==='playing'&&game==='wall')resolveWall('skip')};$('useSkills').onchange=()=>{skillArmed=false;board();controlsSignature='';controls()};$('newSet').onclick=()=>{if(active())return;setNumber=(setNumber+1)%4;wallIndex=0;setTarget();board();glow('已更换关卡组合')};$('train').onclick=train;$('stopCapture').onclick=()=>stopCapture('采集已停止，已有样本保留。');$('start').onclick=startMatch;$('pause').onclick=pause;$('end').onclick=cancelRound;
$('player').oninput=controls;$('duration').onchange=()=>{if(active())return;$('clock').textContent=$('duration').value;board()};$('showDemo').onchange=()=>{setTarget();board()};$('points').onchange=drawSkeleton;
$('sound').onchange=()=>{if($('sound').checked)try{audio??=new(window.AudioContext||window.webkitAudioContext)();audio.resume()}catch{$('sound').checked=false}};
$('nextPlayer').onclick=()=>{$('result').close();state=ready?'ready':'idle';selectGame(game);$('player').value='';$('player').focus();controlsSignature='';controls()};
$('closeResult').onclick=()=>{$('result').close();document.querySelector('.leaderboard').scrollIntoView({block:'start',behavior:'smooth'})};
$('result').addEventListener('close',()=>{if(state==='result'){state=ready?'ready':'idle';counter=new RepCounter(game);practice=0;overlay();$('modeBadge').textContent=`${titles[game]} · 练习区`;controlsSignature='';controls()}});
$('applyCorrection').onclick=()=>{if(!lastResult)return;const n=Number($('correctScore').value),max=Math.floor(lastResult.duration*4),reason=$('correctReason').value.trim();if(!Number.isInteger(n)||n<0||n>max||!reason){$('correctionStatus').textContent=`请填写 0—${max} 的整数和更正原因。`;return}lastResult.score=n;lastResult.correction=reason;board();resultView();$('correctionStatus').textContent='更正已记录。'};
$('clearScores').onclick=()=>{if(!active())$('clearDialog').showModal()};$('cancelClear').onclick=()=>$('clearDialog').close();$('confirmClear').onclick=()=>{if(active())return;rows=[];lastResult=null;board();$('clearDialog').close();controlsSignature='';controls()};
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(['playing','countdown'].includes(state))pause();if(captureJob)stopCapture('切换页面，采集已暂停。已有样本保留。');counter.reset();goodSince=0;latest=null;clearSkeleton()}});
window.addEventListener('pagehide',()=>{release();audio?.close()});new ResizeObserver(drawSkeleton).observe(canvas);
renderCards();selectGame('wall');cameraLoop();requestAnimationFrame(tick);
