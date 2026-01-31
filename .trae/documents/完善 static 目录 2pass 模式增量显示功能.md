## 问题分析
经过对比 static3（功能正常）和 static（需要完善）两个目录的代码，发现关键差异在于 `app.js` 中的 `_handleRecognitionResult` 方法处理中间结果的方式不同：

**static3/app.js（第848行）:**
```javascript
this.currentSentence += newText;  // 增量添加
```

**static/app.js（第194行）:**
```javascript
this.currentSentence = newText;   // 直接替换
```

这导致在 2pass 模式下，static 目录的版本无法正确增量显示识别结果。

## 修改方案

修改 `/Users/mengfangui/work/mfg/company/项目管理/2026年后的文档/语音/FunASR/runtime/html5-new/static/js/app.js` 中的 `_handleRecognitionResult` 方法：

1. 将 `this.currentSentence = newText;` 改为 `this.currentSentence += newText;`
2. 确保 `isSentenceEnd` 判断逻辑与 static3 保持一致
3. 确保 `fullText` 拼接逻辑正确

## 具体修改

文件: `/Users/mengfangui/work/mfg/company/项目管理/2026年后的文档/语音/FunASR/runtime/html5-new/static/js/app.js`

修改 `_handleRecognitionResult` 方法（第165-207行），将中间结果的处理从直接替换改为增量添加。