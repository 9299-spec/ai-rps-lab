// Game poses are a built-in challenge library, separate from trained controls.
const arms={up:[.43,-1.65,.43,-2.25],out:[1,-1,1.65,-1],diagonal:[.9,-1.45,1.4,-1.95],down:[.72,-.4,.94,.15],bent:[1,-1,1,-1.65]};
function figure(left,right,wide=false){const a=arms[left],b=arms[right];return [-.43,-1,.43,-1,-a[0],a[1],b[0],b[1],-a[2],a[3],b[2],b[3],-.28,0,.28,0,wide?-.52:-.28,.85,wide?.52:.28,.85,wide?-.82:-.28,1.7,wide?.82:.28,1.7]}
export const WALL_POSES=[
 ['闪电侠','diagonal','down',false],['大字星星','out','out',true],['火箭升空','up','up',false],['左侧信号','up','out',false],['超级英雄','diagonal','diagonal',true],['右侧信号','out','up',false],['大力士','bent','bent',true],['左翼飞行','diagonal','out',false],['右翼飞行','out','diagonal',false],['招财猫','bent','out',false],['镜像闪电','down','diagonal',false],['快乐小树','up','bent',true]
].map(([name,left,right,wide])=>({name,vector:figure(left,right,wide),wide}));
export function wallSequence(seed=0){const order=[0,1,2,5,6,4,10,7,8,3,9,11];return order.map((_,i)=>order[(i+seed*3)%order.length])}
export function matchWall(v,target){
 if(!v||v.length!==24)return {ok:false,fit:0,hint:'让全身回到画面'};
 const edges=[[0,2],[2,4],[1,3],[3,5]];
 const angles=edges.map(([a,b])=>{const ax=v[b*2]-v[a*2],ay=v[b*2+1]-v[a*2+1],bx=target.vector[b*2]-target.vector[a*2],by=target.vector[b*2+1]-target.vector[a*2+1];const norm=Math.hypot(ax,ay)*Math.hypot(bx,by);return norm>.001?Math.acos(Math.min(1,Math.max(-1,(ax*bx+ay*by)/norm)))*180/Math.PI:180});
 const hip=Math.abs(v[12]-v[14]),feet=Math.abs(v[20]-v[22]),spread=feet/Math.max(hip,.1);
 const legs=target.wide?spread>1.8:spread<1.65;
 const mean=angles.reduce((a,b)=>a+b,0)/4,ok=mean<26&&Math.max(...angles)<48&&legs;
 return {ok,fit:Math.round(Math.max(0,Math.min(100,100-mean*1.4-(legs?0:25)))),hint:!legs?(target.wide?'双脚再分开一点':'双脚靠近一点'):ok?'对上了，保持一下！':'照着洞口调整双臂方向'};
}
