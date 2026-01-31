# FunASR H5 语音识别客户端

基于 FunASR WebSocket 接口的 H5 语音识别客户端，支持实时语音转文字功能。

## 功能特性

- **实时语音识别**: 按住说话，松开发送，实时获取识别结果
- **WebSocket 通信**: 基于 WebSocket 实现音频流实时传输
- **热词支持**: 可配置热词提升特定词汇的识别准确率
- **ITN 支持**: 支持逆文本标准化，自动转换数字和符号
- **模块化架构**: 代码分层清晰，易于维护和扩展
- **完善的错误处理**: 网络异常、权限问题等场景都有友好提示
- **移动端适配**: 支持 iOS Safari、Android Chrome 及微信内置浏览器

## 快速开始

### 1. 部署静态文件

将 `static` 目录下的所有文件部署到 Web 服务器（需要 HTTPS 环境）。

### 2. 配置 WebSocket 服务器

在页面中配置 FunASR WebSocket 服务器地址：

```
wss://your-asr-server:port/
```

### 3. 开始使用

1. 打开页面后，系统会自动尝试连接服务器
2. 连接成功后，长按"按住说话"按钮开始录音
3. 松开按钮结束录音，等待识别结果

## 项目结构

```
static/
├── index.html              # 主页面
├── css/
│   └── style.css           # 样式文件
├── js/
│   ├── app.js              # 应用入口/视图层
│   ├── stateManager.js     # 状态管理模块
│   ├── errorHandler.js     # 错误处理模块
│   ├── wsClient.js         # WebSocket 通信层
│   └── audioRecorder.js    # 音频录制模块
└── lib/
    └── recorder-core.js    # 录音核心库
```

## 模块说明

### 1. 状态管理模块 (stateManager.js)

管理应用的各种状态，包括：
- 连接状态：disconnected、connecting、connected、error
- 录音状态：idle、preparing、recording、stopping
- 应用状态：initializing、ready、processing、error

**主要方法：**
```javascript
// 设置连接状态
stateManager.setConnectionState(ConnectionState.CONNECTED);

// 设置录音状态
stateManager.setRecordingState(RecordingState.RECORDING);

// 监听状态变更
stateManager.on('connectionChange', ({ state, prevState }) => {
    console.log(`连接状态变更: ${prevState} -> ${state}`);
});

// 检查操作是否允许
if (stateManager.canPerform('startRecording')) {
    // 可以开始录音
}
```

### 2. 错误处理模块 (errorHandler.js)

统一处理应用中的各种错误，提供友好的错误提示和自动恢复机制。

**错误类型：**
- NETWORK_ERROR: 网络连接异常
- WEBSOCKET_ERROR: WebSocket 连接失败
- PERMISSION_DENIED: 用户拒绝麦克风权限
- DEVICE_NOT_SUPPORTED: 设备不支持录音
- BROWSER_NOT_SUPPORTED: 浏览器不支持
- HTTPS_REQUIRED: 需要 HTTPS 环境

**使用示例：**
```javascript
// 处理错误
errorHandler.handle(error, { context: 'websocket' });

// 监听错误
errorHandler.on('network_error', (error) => {
    console.log('网络错误:', error.message);
});

// 检查浏览器支持
const support = errorHandler.checkBrowserSupport();
if (!support.supported) {
    console.log('不支持的功能:', support.errors);
}
```

### 3. WebSocket 通信层 (wsClient.js)

负责与 FunASR 服务器的 WebSocket 通信，严格遵循 API.md 接口规范。

**主要功能：**
- 连接管理（连接、断开、自动重连）
- 音频数据发送
- 识别结果接收
- 心跳检测

**使用示例：**
```javascript
const wsClient = new WSClient({
    url: 'wss://192.168.1.17:10095/',
    reconnectAttempts: 3,
    reconnectDelay: 3000
});

// 连接服务器
await wsClient.connect({
    mode: 'offline',
    wavName: 'test',
    itn: true,
    hotwords: '{"阿里巴巴":20}'
});

// 发送音频数据
wsClient.sendAudio(audioData);

// 发送结束信号
wsClient.sendEndSignal();

// 监听识别结果
wsClient.on('result', (result) => {
    console.log('识别结果:', result.text);
});

wsClient.on('complete', (result) => {
    console.log('识别完成:', result.text);
});
```

### 4. 音频录制模块 (audioRecorder.js)

基于 Recorder 库封装，提供统一的录音接口。

**主要功能：**
- 麦克风权限申请
- 音频数据采集
- 采样率转换（48kHz -> 16kHz）
- 音频数据分块

**使用示例：**
```javascript
const recorder = new AudioRecorder({
    sampleRate: 16000,
    chunkDuration: 100,  // 每 100ms 一个数据块
    maxDuration: 60000   // 最大录音 60 秒
});

// 初始化
await recorder.init();

// 开始录音
await recorder.start();

// 监听音频数据
recorder.on('audioData', (data) => {
    // 发送给 WebSocket
    wsClient.sendAudio(data);
});

// 停止录音
await recorder.stop();
```

### 5. 视图层 (app.js)

应用入口，负责 UI 交互和模块协调。

**主要功能：**
- DOM 事件绑定
- 界面状态更新
- 模块间通信协调
- 业务逻辑整合

## API 接口规范

严格遵循 `/Users/mengfangui/work/mfg/company/项目管理/2026年后的文档/语音/FunASR/runtime/html5-new/API.md` 接口文档。

### 连接参数

```json
{
    "mode": "offline",
    "wav_name": "h5_recording",
    "wav_format": "pcm",
    "audio_fs": 16000,
    "is_speaking": true,
    "chunk_size": [5, 10, 5],
    "chunk_interval": 10,
    "itn": true,
    "hotwords": "{\"阿里巴巴\":20}"
}
```

### 识别结果格式

```json
{
    "mode": "offline",
    "wav_name": "h5_recording",
    "text": "识别出的文字",
    "is_final": false,
    "timestamp": [[100,200], [200,500]],
    "stamp_sents": []
}
```

## 浏览器兼容性

| 浏览器 | 最低版本 | 支持情况 |
|--------|----------|----------|
| Chrome | 70+ | 完全支持 |
| Safari | 12+ | 完全支持 |
| Firefox | 65+ | 完全支持 |
| Edge | 79+ | 完全支持 |
| 微信内置浏览器 | 最新版 | 支持 |

**注意：** 录音功能需要在 HTTPS 或 localhost 环境下使用。

## 配置说明

### WebSocket 服务器地址

支持 ws:// 和 wss:// 协议，外网环境建议使用 wss://。

### 热词配置

每行一个热词，格式：`热词 权重`

```
阿里巴巴 20
通义实验室 30
```

权重范围 1-100，值越大识别为该词的概率越高。

### ITN（逆文本标准化）

启用后，识别结果会自动转换数字和符号：
- "百分之九十五" -> "95%"
- "二零二四年" -> "2024年"

## 错误处理

### 常见错误及解决方案

1. **麦克风权限被拒绝**
   - 在浏览器地址栏点击麦克风图标，允许访问
   - 或在浏览器设置中重置权限

2. **WebSocket 连接失败**
   - 检查服务器地址是否正确
   - 检查服务器是否运行
   - 检查网络连接

3. **浏览器不支持**
   - 升级到最新版浏览器
   - 使用 Chrome、Safari 或 Edge

4. **需要 HTTPS**
   - 部署到 HTTPS 服务器
   - 或使用 localhost 进行本地测试

## 开发指南

### 添加新功能

1. **添加新的状态**
   - 在 stateManager.js 中添加状态枚举
   - 在状态变更处理中添加逻辑

2. **添加新的错误类型**
   - 在 errorHandler.js 中添加错误类型
   - 添加错误恢复策略

3. **自定义音频处理**
   - 在 audioRecorder.js 中设置处理回调
   - 或使用 wsClient 的事件监听

### 调试技巧

1. 开启控制台查看详细日志
2. 使用 `stateManager.getHistory()` 查看状态变更历史
3. 使用 `errorHandler.getHistory()` 查看错误历史

## 性能优化

1. **音频数据缓冲**
   - 默认每 100ms 发送一个数据块
   - 可根据网络情况调整 chunkDuration

2. **弱网环境**
   - 自动重连机制
   - 数据队列缓冲

3. **内存管理**
   - 及时释放录音资源
   - 限制状态历史记录大小

## 安全注意事项

1. 不要在 HTTP 环境下使用（除 localhost 外）
2. 妥善保管 WebSocket 服务器地址
3. 生产环境建议使用 wss:// 协议

## 许可证

MIT License

## 参考

- FunASR 项目：https://github.com/alibaba-damo-academy/FunASR
- Recorder 库：https://github.com/xiangyuecn/Recorder
