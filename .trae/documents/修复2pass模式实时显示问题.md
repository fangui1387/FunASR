## 问题分析

在2pass模式下，录音过程中无法实时显示识别文字，只有在录音结束后才显示。经过代码分析，发现以下技术原因：

### 1. wsClient.js 中的 complete 事件触发逻辑问题（第475-484行）

当前代码：
```javascript
const isComplete = result.isFinal === true || 
                  result.mode === '2pass-offline' ||
                  (this.config.mode === 'offline' && result.text);
```

问题：服务器返回的2pass实时识别结果的 `mode` 字段可能是 `"online"` 而非 `"2pass-online"`，但代码逻辑没有正确处理这种情况，导致实时结果被错误地判断为最终结果。

### 2. app.js 中的 currentSentence 累加逻辑问题（第189-193行）

当前代码：
```javascript
} else {
    // 中间结果，更新当前句子
    this.currentSentence = newText;  // 直接赋值，不是累加
}
```

问题：中间结果应该累加，但当前代码直接赋值，导致只显示最新片段。

## 修复方案

### 修改1: wsClient.js（第447-485行）

修改 `_handleRecognitionResult` 方法中的 `isComplete` 判断逻辑：
- 只有当 `result.mode === '2pass-offline'` 或 `result.isFinal === true` 时才触发 complete 事件
- 对于2pass模式的实时结果（mode为'online'或'2pass-online'），只触发 result 事件，不触发 complete

### 修改2: app.js（第181-194行）

修改 `_handleRecognitionResult` 方法中的 `currentSentence` 处理逻辑：
- 将 `this.currentSentence = newText;` 改为累加方式 `this.currentSentence += newText;`
- 参考 static-bak 目录中的历史实现

## 修复后验证

修复完成后，需要在2pass模式下测试：
1. 启动录音后，实时识别文字应立即显示
2. 说话过程中，文字应持续更新
3. 录音结束后，最终结果显示正常
4. 无延迟或显示异常