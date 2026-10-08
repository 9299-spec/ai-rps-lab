// Hand landmarks are independent from the child's trained gesture classifier.
let detector=null;
self.onmessage=async({data})=>{
 if(data.type==='init'){
  try{
   const {FilesetResolver,HandLandmarker}=await import('./vendor/vision_bundle.mjs');
   const wasm=await FilesetResolver.forVisionTasks(new URL('./vendor/vision-wasm/',self.location.href).href.replace(/\/$/,''));
   detector=await HandLandmarker.createFromOptions(wasm,{baseOptions:{modelAssetPath:new URL('./model/hand_landmarker.task',self.location.href).href,delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.5});
   self.postMessage({type:'ready'});
  }catch(e){self.postMessage({type:'error',message:e.message})}
 }else if(data.type==='frame'){
  try{if(!detector)throw Error('关键点组件尚未就绪');const result=detector.detectForVideo(data.bitmap,data.time);self.postMessage({type:'result',session:data.session,landmarks:result.landmarks,width:data.bitmap.width,height:data.bitmap.height})}
  catch(e){self.postMessage({type:'error',message:e.message})}
  finally{data.bitmap.close()}
 }
};
