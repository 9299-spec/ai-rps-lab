let detector=null;
self.onmessage=async({data})=>{
 if(data.type==='init'){
  try{
   const {FilesetResolver,PoseLandmarker}=await import('../vendor/vision_bundle.mjs');
   const wasm=await FilesetResolver.forVisionTasks(new URL('../vendor/vision-wasm',self.location.href).href);
   detector=await PoseLandmarker.createFromOptions(wasm,{baseOptions:{modelAssetPath:new URL('../model/pose_landmarker_lite.task',self.location.href).href,delegate:'CPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.55,minPosePresenceConfidence:.55,minTrackingConfidence:.55,outputSegmentationMasks:false});
   self.postMessage({type:'ready'});
  }catch(e){self.postMessage({type:'error',message:e.message})}
 }else if(data.type==='frame'){
  try{
   const result=detector.detectForVideo(data.bitmap,data.time);
   self.postMessage({type:'result',session:data.session,time:data.time,landmarks:result.landmarks[0]||null,width:data.bitmap.width,height:data.bitmap.height});
  }catch(e){self.postMessage({type:'error',message:e.message})}
  finally{data.bitmap.close()}
 }
};
