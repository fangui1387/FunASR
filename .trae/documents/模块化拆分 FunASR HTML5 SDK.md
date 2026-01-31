## 需求分析

目标：将 `app.js` 拆分为独立的SDK模块，使其他H5页面只需引入相关JS文件，即可通过API调用语音识别功能，无需依赖特定的UI结构。

## 现有代码结构分析

当前 `app.js` 包含以下功能：
1. **ASRApp类** - 主应用类，依赖特定DOM元素（configPanel、recordBtn等）
2. **UI绑定逻辑** - 绑定按钮事件、更新UI状态
3. **语音识别核心逻辑** - 处理识别结果、多句拼接等
4. **录音控制** - 开始/停止录音

## 拆分方案

### 核心思路
创建一个新的 **FunASRController** 类，将语音识别核心逻辑与UI解耦：
- 不依赖特定DOM元素
- 提供事件回调机制（onResult、onComplete、onError等）
- 提供API方法（startRecording、stopRecording等）
- 保持与现有WSClient、AudioRecorder的兼容性

### 文件结构

**1. 保留现有文件（不修改）**
- `js/stateManager.js`
- `js/errorHandler.js`
- `js/wsClient.js`
- `js/audioRecorder.js`

**2. 修改 `js/app.js`**
将其改造为 **FunASRController** SDK类：
- 移除DOM依赖
- 提供配置选项（通过构造函数传入）
- 提供事件回调接口
- 提供录音控制API

**3. `index.html` 中的使用方式**
在 `index.html` 的script标签中：
- 引入所有JS文件
- 创建FunASRController实例
- 绑定到现有UI元素

### 具体实现

**FunASRController 类结构：**
```javascript
class FunASRController {
    constructor(options) {
        // options包含：wsUrl, mode, hotwords, itn等
        // 初始化WSClient、AudioRecorder
        // 绑定事件回调
    }
    
    // 事件回调设置
    onResult(callback) {}
    onComplete(callback) {}
    onError(callback) {}
    onStart(callback) {}
    onStop(callback) {}
    
    // API方法
    async startRecording() {}
    async stopRecording() {}
    async connect() {}
    disconnect() {}
    
    // 配置更新
    setMode(mode) {}
    setUrl(url) {}
    updateConfig(config) {}
    
    // 状态获取
    isRecording() {}
    isConnected() {}
    getResults() {}
    clearResults() {}
    
    // 销毁
    destroy() {}
}
```

**index.html 中的集成：**
```javascript
// 创建控制器实例
const asrController = new FunASRController({
    wsUrl: 'ws://192.168.1.17:10095/',
    mode: '2pass',
    itn: true
});

// 绑定事件
asrController.onResult((result) => {
    // 更新UI显示实时结果
});
asrController.onComplete((result) => {
    // 更新UI显示最终结果
});

// 绑定按钮事件
document.getElementById('recordBtn').addEventListener('click', () => {
    asrController.startRecording();
});
```

### 需要修改的文件

1. **`/Users/mengfangui/work/mfg/company/项目管理/2026年后的文档/语音/FunASR/runtime/html5-new/static/js/app.js`**
   - 完全重写为FunASRController类
   - 移除DOM依赖
   - 提供事件回调机制

### 优势

1. **解耦**：核心逻辑与UI完全分离
2. **可复用**：其他H5页面只需引入JS文件，调用API即可
3. **灵活性**：开发者可以自定义UI，只需调用startRecording/stopRecording
4. **兼容性**：保持与现有WSClient、AudioRecorder的兼容
5. **简单集成**：提供清晰的API和事件回调

### 集成文档（提供给其他H5页面）

```html
<!-- 1. 引入必要文件 -->
<script src="lib/recorder-core.js"></script>
<script src="js/stateManager.js"></script>
<script src="js/errorHandler.js"></script>
<script src="js/wsClient.js"></script>
<script src="js/audioRecorder.js"></script>
<script src="js/app.js"></script>

<!-- 2. 创建自己的UI -->
<button id="myRecordBtn">开始录音</button>
<button id="myStopBtn">停止录音</button>
<div id="myResult">识别结果将显示在这里</div>

<!-- 3. 调用API -->
<script>
const asr = new FunASRController({
    wsUrl: 'ws://192.168.1.17:10095/',
    mode: '2pass'
});

asr.onResult((result) => {
    document.getElementById('myResult').textContent = result.text;
});

document.getElementById('myRecordBtn').addEventListener('click', () => {
    asr.startRecording();
});

document.getElementById('myStopBtn').addEventListener('click', () => {
    asr.stopRecording();
});
</script>
```