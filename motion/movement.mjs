// Full-cycle recognition. All distances are relative to this frame's body size.
export const STAGES = [
 {name:'摘星星',icon:'✦',action:'左右手轮流向上伸',detail:'一只手伸过头顶，再放下。换另一只手，摘下一颗星星。',unit:'颗星星',theme:'stars'},
 {name:'开合护盾',icon:'◈',action:'双臂向两侧打开，再放下',detail:'像小飞机一样平举双臂，随后自然放下。双脚站稳，不用跳。',unit:'次护盾',theme:'shield'},
 {name:'穿越森林',icon:'♧',action:'原地踏步，左右腿交替',detail:'一侧膝盖轻轻抬起、落下，再换另一侧。不用跑，也不用跳。',unit:'步探索',theme:'forest'}
];
export function inspectPose(p, stage=0) {
 if (!p || p.length<33) return {ok:false,message:'站进画面，让 AI 看见你'};
 const ids=stage===2?[11,12,23,24,25,26,27,28]:[0,11,12,13,14,15,16,23,24,27,28];
 if(ids.some(i=>!Number.isFinite(p[i]?.x)||!Number.isFinite(p[i]?.y)||(p[i].visibility??0)<.55||(p[i].presence??1)<.55))
  return {ok:false,message:stage===2?'让双腿和脚踝清楚地出现在画面里':'让头、双手和双脚清楚地出现在画面里'};
 if(ids.some(i=>p[i].x<.015||p[i].x>.985||p[i].y<.015||p[i].y>.985)) return {ok:false,message:'稍微往后站一点，给动作留出空间'};
 const sy=(p[11].y+p[12].y)/2,hy=(p[23].y+p[24].y)/2,torso=hy-sy,sw=Math.abs(p[11].x-p[12].x);
 if(torso<.09||sw<.065) return {ok:false,message:'面向摄像头，站到能看清全身的位置'};
 return {ok:true,sy,hy,torso,sw,message:'已看清身体，可以开始啦'};
}
export class MovementCounter {
 constructor(stage=0){this.stage=stage;this.count=0;this.lastSide=null;this.resetCycle()}
 resetCycle(){this.phase='needDown';this.candidate=null;this.since=0;this.pendingSide=null;this.lastTime=null}
 update(p,now){
  if(this.lastTime!==null&&now-this.lastTime>850)this.resetCycle();
  this.lastTime=now;
  const f=inspectPose(p,this.stage);
  if(!f.ok){this.resetCycle();return {counted:false,ok:false,hint:f.message}}
  const {sy,hy,torso:t,sw}=f;
  let low=false,side=null;
  if(this.stage===0){
   low=p[15].y>sy+.30*t&&p[16].y>sy+.30*t;
   if(p[15].y<p[0].y-.10*t&&p[16].y>sy+.2*t)side='left';
   if(p[16].y<p[0].y-.10*t&&p[15].y>sy+.2*t)side='right';
  }else if(this.stage===1){
   low=p[15].y>sy+.5*t&&p[16].y>sy+.5*t;
   if(Math.abs(p[15].y-sy)<.32*t&&Math.abs(p[16].y-sy)<.32*t&&Math.abs(p[15].x-p[16].x)>1.8*sw)side='both';
  }else{
   const d=p[25].y-p[26].y;
   low=Math.abs(d)<.18*t;
   if(d<-.38*t&&p[25].y<hy+.95*t)side='left';
   if(d>.38*t&&p[26].y<hy+.95*t)side='right';
  }
  let hint=this.stage===0?'伸一只手过头顶':this.stage===1?'双臂平举，像一架小飞机':'轻轻抬起一侧膝盖';
  let signal=null;
  if(this.phase==='needDown'){signal=low?'down':null;hint=this.stage===2?'先让双脚落地，准备好':'先把双手自然放下，准备好'}
  else if(this.phase==='ready'){
   if(side&&side!==this.lastSide)signal=side;
   else if(side&&side===this.lastSide)hint=this.stage===2?'这次换另一条腿试试':'这次换另一只手摘星星';
   else if(this.lastSide&&this.stage!==1)hint=this.stage===2?'换另一条腿，轻轻抬膝':'换另一只手，伸过头顶';
  }else {signal=low?'down':null;hint=this.stage===2?'轻轻落脚，这一步就完成了':'慢慢放下手臂，完成这一次'}
  if(signal!==this.candidate){this.candidate=signal;this.since=now}
  let counted=false;
  if(signal&&now-this.since>=160){
   if(this.phase==='needDown')this.phase='ready';
   else if(this.phase==='ready'){this.phase='raised';this.pendingSide=signal}
   else {this.count++;counted=true;this.lastSide=this.stage===1?null:this.pendingSide;this.phase='ready';this.pendingSide=null}
   this.candidate=null;this.since=now;
  }
  return {ok:true,counted,hint,count:this.count};
 }
}
