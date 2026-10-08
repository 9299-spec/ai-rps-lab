// Body landmarks come from a pretrained model. Pose labels are learned here
// from the children's examples using an explicit nearest-neighbour classifier.
export const BODY=[11,12,13,14,15,16,23,24,25,26,27,28];
export function quality(p,game='wall'){
 if(!p||p.length!==33)return {ok:false,hint:'请一人入镜，让 AI 看见全身'};
 const ids=game==='knees'?[11,12,23,24,25,26,27,28]:[0,...BODY];
 if(ids.some(i=>!Number.isFinite(p[i]?.x)||!Number.isFinite(p[i]?.y)||(p[i].visibility??0)<.55||(p[i].presence??1)<.55))return {ok:false,hint:game==='knees'?'请让髋部、膝盖和脚踝清晰入镜':'请让头、双手和脚踝清晰入镜'};
 if(ids.some(i=>p[i].x<.01||p[i].x>.99||p[i].y<.01||p[i].y>.99))return {ok:false,hint:'往后站一点，让整个动作留在画面里'};
 const sy=(p[11].y+p[12].y)/2,hy=(p[23].y+p[24].y)/2,t=hy-sy,hw=Math.abs(p[23].x-p[24].x);
 if(t<.085||hw<.045)return {ok:false,hint:'面向摄像头，站到能看清身体的位置'};
 return {ok:true,sy,hy,t,hw,hint:'身体已看清，可以开始'};
}
export function features(p,aspect=4/3){
 if(!quality(p).ok)return null;
 const cx=(p[23].x+p[24].x)/2,cy=(p[23].y+p[24].y)/2;
 const sx=(p[11].x+p[12].x)/2,sy=(p[11].y+p[12].y)/2;
 const scale=Math.hypot((sx-cx)*aspect,sy-cy);
 return BODY.flatMap(i=>[(p[i].x-cx)*aspect/scale,(p[i].y-cy)/scale]);
}
export const distance=(a,b)=>Math.sqrt(a.reduce((sum,v,i)=>sum+(v-b[i])**2,0)/a.length);
function nearestMean(v,rows,omit=-1){return rows.map((x,i)=>i===omit?Infinity:distance(v,x)).sort((a,b)=>a-b).slice(0,Math.min(3,rows.length-(omit>=0?1:0))).reduce((a,b)=>a+b,0)/Math.min(3,rows.length-(omit>=0?1:0))}
export function trainPoses(groups,version){
 if(groups.length<2||groups.some(g=>g.samples.length<8))throw Error('每个姿势至少需要 8 个有效样本');
 const classes=groups.map(g=>{
  const rows=g.samples.map(v=>v.slice());
  if(rows.some(v=>v.length!==BODY.length*2||v.some(x=>!Number.isFinite(x))))throw Error('样本无效，请重新采集');
  const deviations=rows.map((v,i)=>nearestMean(v,rows,i)).sort((a,b)=>a-b);
  const threshold=Math.min(.48,Math.max(.16,deviations[Math.floor(deviations.length*.9)]*2+.08));
  const mean=rows[0].map((_,i)=>rows.reduce((s,v)=>s+v[i],0)/rows.length);
  const prototype=rows.reduce((best,v)=>distance(v,mean)<distance(best,mean)?v:best,rows[0]);
  return {name:g.name,rows,threshold,prototype};
 });
 const warnings=[];
 for(let i=0;i<classes.length;i++)for(let j=i+1;j<classes.length;j++)if(distance(classes[i].prototype,classes[j].prototype)<.18)warnings.push(`${classes[i].name}与${classes[j].name}很相似，建议换更不同的姿势`);
 return {classes,version,warnings};
}
export function predictPose(model,v){
 if(!model||!v)return {index:-1,label:'暂时不确定'};
 const ranks=model.classes.map((c,i)=>({i,d:nearestMean(v,c.rows)})).sort((a,b)=>a.d-b.d);
 const a=ranks[0],b=ranks[1];
 const certain=a.d<=model.classes[a.i].threshold&&b.d-a.d>=Math.max(.045,a.d*.2);
 return {index:certain?a.i:-1,label:certain?model.classes[a.i].name:'暂时不确定',distance:a.d};
}
export class RepCounter{
 constructor(game){this.game=game;this.count=0;this.lastSide=null;this.reset()}
 reset(){this.phase='settle';this.pending=null;this.candidate=null;this.since=0;this.lastTime=null}
 update(p,now){
  if(this.lastTime!==null&&now-this.lastTime>800)this.reset();this.lastTime=now;
  const q=quality(p,this.game);if(!q.ok){this.reset();return {counted:false,hint:q.hint}}
  const {sy,hy,t,hw}=q;let low=false,high=null;
  if(this.game==='knees'){
   low=p[25].y>hy+.58*t&&p[26].y>hy+.58*t;
   if(p[25].y<hy+.28*t&&p[26].y-p[25].y>.35*t)high='left';
   if(p[26].y<hy+.28*t&&p[25].y-p[26].y>.35*t)high='right';
  }else{
   const feet=Math.abs(p[27].x-p[28].x);
   low=p[15].y>sy+.6*t&&p[16].y>sy+.6*t&&feet<hw*1.5;
   if(p[15].y<sy-.45*t&&p[16].y<sy-.45*t&&feet>hw*2)high='open';
  }
  let hint=this.game==='knees'?'交替抬膝到髋部附近，再落脚':'双脚打开、双臂举高，再一起合拢';
  let signal=null;
  if(this.phase==='settle'){signal=low?'low':null;hint=this.game==='knees'?'先双脚落地，准备出发':'先双脚合拢、双手放下'}
  else if(this.phase==='ready'){signal=high&&high!==this.lastSide?high:null;if(high===this.lastSide&&high)hint='请换另一条腿'}
  else {signal=low?'low':null;hint=this.game==='knees'?'抬膝到位！落脚后计 1 次':'打开到位！合拢后计 1 次'}
  if(signal!==this.candidate){this.candidate=signal;this.since=now}
  let counted=false;
  if(signal&&now-this.since>=110){
   if(this.phase==='settle')this.phase='ready';
   else if(this.phase==='ready'){this.phase='raised';this.pending=signal}
   else {this.count++;counted=true;this.lastSide=this.game==='knees'?this.pending:null;this.phase='ready'}
   this.candidate=null;
  }
  return {counted,hint,atTarget:this.phase==='raised'};
 }
}
export function schedule(n,seconds){const sequence=[0,1,2,1,0,2,0,2,1];return Array.from({length:seconds/5},(_,i)=>sequence[i%sequence.length]%n)}
export function ranked(rows,key){return rows.filter(r=>r.key===key).sort((a,b)=>b.score-a.score||a.id-b.id).map((r,i,all)=>({...r,rank:all.findIndex(x=>x.score===r.score)+1}))}
