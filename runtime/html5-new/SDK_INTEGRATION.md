# FunASR Web SDK 集成文档

## 简介

FunASR Web SDK 提供了在 H5 页面中实现语音识别功能的能力，支持离线识别(offline)、实时识别(online)和两遍识别(2pass)三种模式。

## 快速开始

### 1. 引入必要文件

在 HTML 文件的 `<head>` 或 `<body>` 底部引入以下文件：

```html
<!-- 录音核心库 -->
<script src="path/to/funasr/lib/recorder-core.js"></script>

<!-- SDK 核心模块 -->
<script src="path/to/funasr/js/stateManager.js"></script>
<script src="path/to/funasr/js/errorHandler.js"></script>
<script src="path/to/funasr/js/wsClient.js"></script>
<script src="path/to/funasr/js/audioRecorder.js"></script>
<script src="path/to/funasr/js/app.js"></script>
```

### 2. 创建 UI 元素

```html
<!-- 录音按钮 -->
<button id="startBtn">开始录音</button>
<button id="stopBtn">停止录音</button>

<!-- 结果显示区域 -->
<div id="result">识别结果将显示在这里</div>
```

### 3. 初始化 SDK 并绑定事件

```javascript
// 创建 SDK 实例
const asr = new FunASRController({
    wsUrl: 'ws://192.168.1.17:10095/',  // WebSocket服务器地址
    mode: '2pass',                       // 识别模式: offline | online | 2pass
    itn: true                            // 是否启用逆文本标准化
});

// 绑定识别结果事件
asr.onResult((result) => {
    // 实时识别结果
    console.log('识别中:', result.fullText);
    document.getElementById('result').textContent = result.fullText;
});

// 绑定识别完成事件
asr.onComplete((result) => {
    // 最终识别结果
    console.log('识别完成:', result.fullText);
    document.getElementById('result').textContent = result.fullText;
});

// 绑定错误事件
asr.onError((error) => {
    console.error('识别错误:', error);
    alert('识别出错: ' + error.message);
});

// 绑定按钮事件
document.getElementById('startBtn').addEventListener('click', () => {
    asr.startRecording();
});

document.getElementById('stopBtn').addEventListener('click', () => {
    asr.stopRecording();
});
```

## API 参考

### FunASRController 类

#### 构造函数

```javascript
const asr = new FunASRController(options);
```

**options 参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| wsUrl | string | 'ws://192.168.1.17:10095/' | WebSocket 服务器地址 |
| mode | string | 'offline' | 识别模式：'offline'、'online'、'2pass' |
| itn | boolean | true | 是否启用逆文本标准化 |
| hotwords | string | null | 热词配置 |

#### 事件监听方法

##### onResult(callback)
监听实时识别结果。

```javascript
asr.onResult((result) => {
    console.log(result.text);      // 当前识别文本
    console.log(result.fullText);  // 完整拼接文本（2pass/online模式）
    console.log(result.mode);      // 当前模式
    console.log(result.isFinal);   // 是否为最终结果
});
```

##### onComplete(callback)
监听识别完成事件。

```javascript
asr.onComplete((result) => {
    console.log('最终文本:', result.fullText);
});
```

##### onError(callback)
监听错误事件。

```javascript
asr.onError((error) => {
    console.error('错误:', error.message);
});
```

##### onStart(callback)
监听录音开始事件。

```javascript
asr.onStart(() => {
    console.log('录音开始');
});
```

##### onStop(callback)
监听录音停止事件。

```javascript
asr.onStop(() => {
    console.log('录音停止');
});
```

##### onConnecting(callback)
监听连接中事件。

```javascript
asr.onConnecting(() => {
    console.log('连接中...');
});
```

##### onConnected(callback)
监听连接成功事件。

```javascript
asr.onConnected(() => {
    console.log('已连接');
});
```

##### onDisconnected(callback)
监听连接断开事件。

```javascript
asr.onDisconnected(() => {
    console.log('连接断开');
});
```

#### 控制方法

##### startRecording(params)
开始录音。

```javascript
await asr.startRecording({
    mode: '2pass',        // 可选，覆盖默认模式
    hotwords: '阿里巴巴'  // 可选，热词
});
```

##### stopRecording()
停止录音。

```javascript
await asr.stopRecording();
```

##### connect(params)
手动连接到服务器（通常不需要，startRecording 会自动连接）。

```javascript
await asr.connect({
    mode: '2pass'
});
```

##### disconnect()
断开连接。

```javascript
asr.disconnect();
```

#### 配置方法

##### setMode(mode)
设置识别模式。

```javascript
asr.setMode('online');
```

##### setUrl(url)
设置 WebSocket 地址。

```javascript
asr.setUrl('ws://192.168.1.17:10095/');
```

##### updateConfig(config)
更新配置。

```javascript
asr.updateConfig({
    mode: '2pass',
    itn: true
});
```

#### 状态获取方法

##### isRecording()
是否正在录音。

```javascript
if (asr.isRecording()) {
    console.log('正在录音中...');
}
```

##### isConnected()
是否已连接。

```javascript
if (asr.isConnected()) {
    console.log('已连接到服务器');
}
```

##### getResults()
获取所有识别结果。

```javascript
const results = asr.getResults();
results.forEach(result => {
    console.log(result.text);
});
```

##### getCurrentText()
获取当前识别文本。

```javascript
const text = asr.getCurrentText();
```

##### clearResults()
清空识别结果。

```javascript
asr.clearResults();
```

#### 销毁方法

##### destroy()
销毁 SDK 实例，释放资源。

```javascript
asr.destroy();
```

## 识别模式说明

### offline（离线模式）
- 录音结束后一次性识别
- 适合短语音、对实时性要求不高的场景
- 识别准确率最高

### online（实时模式）
- 边录音边识别，实时返回结果
- 适合长语音、需要实时反馈的场景
- 结果会实时更新

### 2pass（两遍模式）
- 结合实时识别和离线精识别
- 第一遍实时返回结果，第二遍离线精修
- 适合对准确率和实时性都有要求的场景

## 完整示例

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>语音识别示例</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .btn { padding: 10px 20px; margin: 5px; cursor: pointer; }
        .result { margin-top: 20px; padding: 15px; border: 1px solid #ddd; min-height: 100px; }
        .status { margin-top: 10px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h1>语音识别</h1>
        
        <div>
            <button class="btn" id="startBtn">开始录音</button>
            <button class="btn" id="stopBtn" disabled>停止录音</button>
        </div>
        
        <div class="status" id="status">准备就绪</div>
        <div class="result" id="result">识别结果将显示在这里...</div>
    </div>

    <!-- 引入 SDK -->
    <script src="path/to/funasr/lib/recorder-core.js"></script>
    <script src="path/to/funasr/js/stateManager.js"></script>
    <script src="path/to/funasr/js/errorHandler.js"></script>
    <script src="path/to/funasr/js/wsClient.js"></script>
    <script src="path/to/funasr/js/audioRecorder.js"></script>
    <script src="path/to/funasr/js/app.js"></script>

    <script>
        // DOM 元素
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');
        const statusDiv = document.getElementById('status');
        const resultDiv = document.getElementById('result');

        // 创建 SDK 实例
        const asr = new FunASRController({
            wsUrl: 'ws://192.168.1.17:10095/',
            mode: '2pass'
        });

        // 事件绑定
        asr.onResult((result) => {
            resultDiv.textContent = result.fullText || result.text;
        });

        asr.onComplete((result) => {
            resultDiv.textContent = result.fullText || result.text;
            statusDiv.textContent = '识别完成';
            startBtn.disabled = false;
            stopBtn.disabled = true;
        });

        asr.onError((error) => {
            statusDiv.textContent = '错误: ' + error.message;
            startBtn.disabled = false;
            stopBtn.disabled = true;
        });

        asr.onStart(() => {
            statusDiv.textContent = '正在录音...';
            startBtn.disabled = true;
            stopBtn.disabled = false;
            resultDiv.textContent = '';
        });

        asr.onStop(() => {
            statusDiv.textContent = '处理中...';
        });

        // 按钮事件
        startBtn.addEventListener('click', async () => {
            try {
                await asr.startRecording();
            } catch (error) {
                alert('启动失败: ' + error.message);
            }
        });

        stopBtn.addEventListener('click', async () => {
            await asr.stopRecording();
        });
    </script>
</body>
</html>
```

## 注意事项

1. **浏览器兼容性**：需要使用支持 Web Audio API 和 WebSocket 的现代浏览器
2. **HTTPS 要求**：在 HTTPS 环境下使用麦克风需要用户授权
3. **服务器地址**：确保 WebSocket 服务器地址正确且可访问
4. **资源释放**：页面卸载时调用 `destroy()` 方法释放资源

## 常见问题

### Q: 如何切换识别模式？
A: 使用 `setMode()` 方法或在 `startRecording()` 时传入 mode 参数。

### Q: 如何获取实时识别结果？
A: 使用 `onResult()` 监听实时结果，在 2pass/online 模式下 `result.fullText` 包含拼接后的完整文本。

### Q: 如何自定义热词？
A: 在配置中传入 hotwords 参数，格式为字符串，每行一个热词和权重，如：
```javascript
const asr = new FunASRController({
    hotwords: '阿里巴巴 20\n通义实验室 30'
});
```

### Q: 如何知道录音是否已经开始？
A: 使用 `onStart()` 监听录音开始事件，或使用 `isRecording()` 获取当前状态。
