# AI 猜拳实验室

适用于小学高年级的浏览器 AI 实验：采集自己的手势照片、训练两个模型、用独立照片比较效果、教机器胜负规则，再与电脑猜拳。

## 使用

打开 GitHub Pages 网址，允许使用摄像头。每类至少 5 张照片可试训，建议 20—30 张；照片和训练模型只保存在当前页面内存中，刷新后清空。电脑在倒计时前随机选好手势，结束时锁定孩子的画面并亮拳，识别后按孩子提交的规则自动计分。

## 本地预览

在此目录运行 `python -m http.server 8765`，打开 `http://localhost:8765`。摄像头需要 HTTPS 或 localhost。

## GitHub Pages

在仓库 Settings → Pages，选择 Deploy from a branch，使用 main 分支的根目录 / (root)。所有文件均为静态资源，无需服务器或 API 密钥。

## 组件与原理

使用 TensorFlow.js 4.22.0 与预训练 MobileNet v1 0.25 模型进行特征提取，孩子的照片训练一个新的三类分类器。模型、权重和运行库随网站加载；手部照片不会上传。预测分数不是正确保证，空画面和陌生手势也可能被误认。

- TensorFlow.js：https://github.com/tensorflow/tfjs （Apache-2.0）
- MobileNet 模型项目：https://github.com/tensorflow/tfjs-models/tree/master/mobilenet （Apache-2.0）

## 手部关键点

开启摄像头后，可显示每只手最多 21 个关节点及连线。点编号可开关。MediaPipe Hand Landmarker 在独立工作线程运行；此预训练模型用于可视化，孩子训练的分类器仍负责猜拳识别。模型和运行文件随网页加载，照片不上传。

MediaPipe：https://github.com/google-ai-edge/mediapipe （Apache-2.0）。

## AI 运动闯关

访问 `motion/`：三关分别为交替伸手摘星、双臂侧平举开合、交替原地踏步。每关 30 秒，关间休息至少 10 秒后手动继续；完整动作才记次，看不清身体时暂停计时，切换标签页暂停。显示身体关键点和连线。完成后自动关闭摄像头，不录像、不保存或上传身体画面。

使用随站点加载的 MediaPipe Tasks Vision 0.10.14 与 Pose Landmarker Lite（预训练模型，33 个关键点）；动作计数为带滞回及持续时间判断的规则程序，不是孩子训练的新模型，也不是专业体态评估。模型和软件来自 Google MediaPipe（Apache-2.0）：https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker 。

建议电脑 Chrome / Edge，一次一人面向摄像头，让头和脚踝都在画面里。首次会加载约 6 MB 的身体模型及视觉运行库。
