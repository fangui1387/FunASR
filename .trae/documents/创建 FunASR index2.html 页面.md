## 计划概述
根据 SDK_INTEGRATION.md 文档，在 `/Users/mengfangui/work/mfg/company/项目管理/2026年后的文档/语音/FunASR/runtime/html5-new` 目录下创建 index2.html 文件。

## 文件结构
- **目标位置**: `/Users/mengfangui/work/mfg/company/项目管理/2026年后的文档/语音/FunASR/runtime/html5-new/index2.html`
- **引用路径**: `static/js/` 目录下的 SDK 文件

## 实现内容

### 1. 界面组件
- 两个按钮："开始录音" 和 "结束录音"
- 一个文本显示区域用于展示识别结果
- 状态显示区域

### 2. 功能实现
- 引入 SDK 文件（stateManager.js, errorHandler.js, wsClient.js, audioRecorder.js, app.js）
- 创建 FunASRController 实例
- 绑定 onResult 事件实时显示识别结果
- 绑定 onComplete 事件显示最终结果
- 绑定 onError 事件处理错误
- 绑定 onStart/onStop 事件更新按钮状态
- 实现开始/停止录音按钮功能

### 3. 技术要求
- 使用 SDK 规定的 API 方法
- 支持现代浏览器
- 添加错误处理和用户提示
- WebSocket 地址使用 `ws://192.168.1.17:10095/`
- 默认使用 offline 模式

### 4. 保护措施
- 不修改或删除现有 static/index.html 文件
- 只在 runtime/html5-new 目录下创建新文件