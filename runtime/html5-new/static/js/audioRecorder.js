/**
 * 音频录制模块
 * 使用原生 Web Audio API 录制 PCM 音频
 */

(function(window) {
    'use strict';

    // 默认配置
    const DEFAULT_CONFIG = {
        sampleRate: 16000,
        bufferSize: 4096,
        chunkDuration: 100, // 每个数据块的时长(ms)
        maxDuration: 600000  // 最大录音时长(ms) 10分钟
    };

    // 录音状态枚举
    const RecorderState = {
        IDLE: 'idle',
        INITIALIZING: 'initializing',
        RECORDING: 'recording',
        PAUSED: 'paused',
        STOPPING: 'stopping',
        ERROR: 'error'
    };

    /**
     * 音频录制器类
     */
    class AudioRecorder {
        constructor(options = {}) {
            this.config = { ...DEFAULT_CONFIG, ...options };
            
            // AudioContext 和相关节点
            this.audioContext = null;
            this.mediaStreamSource = null;
            this.scriptProcessor = null;
            this.mediaStream = null;
            
            // 当前状态
            this.state = RecorderState.IDLE;
            
            // 音频数据缓冲
            this.sampleBuffer = [];
            this._maxBufferSize = 16000 * 300; // 最大缓冲300秒的音频数据（16kHz采样率）
            
            // 录音统计
            this.stats = {
                startTime: 0,
                duration: 0,
                totalSamples: 0,
                chunksSent: 0
            };
            
            // 事件监听器
            this._listeners = new Map();
            
            // 定时器
            this._durationTimer = null;
            this._maxDurationTimer = null;
            
            // 音频处理回调
            this._onProcessCallback = null;
            
            // 防止重复初始化
            this._initializing = false;
        }

        /**
         * 注册事件监听
         */
        on(event, callback) {
            if (!this._listeners.has(event)) {
                this._listeners.set(event, new Set());
            }
            this._listeners.get(event).add(callback);
            
            return () => {
                this._listeners.get(event).delete(callback);
            };
        }

        /**
         * 触发事件
         */
        _emit(event, data) {
            const listeners = this._listeners.get(event);
            if (listeners) {
                listeners.forEach(callback => {
                    try {
                        callback(data);
                    } catch (error) {
                        console.error(`AudioRecorder: Error in ${event} listener:`, error);
                    }
                });
            }
        }

        /**
         * 检查浏览器支持
         */
        checkSupport() {
            const support = {
                getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
                audioContext: !!(window.AudioContext || window.webkitAudioContext),
                webAudio: !!(window.AudioContext || window.webkitAudioContext)
            };
            
            return {
                supported: support.getUserMedia && support.audioContext,
                details: support
            };
        }

        /**
         * 初始化录音器
         */
        async init() {
            // 防止重复初始化
            if (this._initializing) {
                return new Promise((resolve, reject) => {
                    const checkInit = () => {
                        if (!this._initializing) {
                            if (this.state !== RecorderState.ERROR) {
                                resolve();
                            } else {
                                reject(new Error('初始化失败'));
                            }
                            return;
                        }
                        setTimeout(checkInit, 100);
                    };
                    checkInit();
                });
            }

            // 如果已经初始化，直接返回
            if (this.audioContext && this.state === RecorderState.IDLE) {
                return;
            }

            // 检查支持情况
            const support = this.checkSupport();
            if (!support.supported) {
                console.warn('AudioRecorder: Browser may not fully support recording:', support.details);
            }

            this._initializing = true;

            return new Promise((resolve, reject) => {
                this.state = RecorderState.INITIALIZING;
                
                try {
                    // 获取麦克风权限
                    navigator.mediaDevices.getUserMedia({ 
                        audio: {
                            sampleRate: 16000, // 浏览器通常返回 48kHz
                            channelCount: 1,
                            echoCancellation: false,
                            noiseSuppression: false,
                            autoGainControl: false
                        } 
                    }).then(stream => {
                        this.mediaStream = stream;
                        
                        // 创建 AudioContext
                        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                        this.audioContext = new AudioContextClass({
                            sampleRate: 16000 // 使用浏览器默认采样率
                        });
                        
                        // 创建媒体源
                        this.mediaStreamSource = this.audioContext.createMediaStreamSource(stream);
                        
                        // 创建脚本处理器
                        this.scriptProcessor = this.audioContext.createScriptProcessor(
                            this.config.bufferSize, 
                            1, 
                            1
                        );
                        
                        // 连接节点
                        this.mediaStreamSource.connect(this.scriptProcessor);
                        this.scriptProcessor.connect(this.audioContext.destination);
                        
                        // 处理音频数据
                        this.scriptProcessor.onaudioprocess = (e) => {
                            if (this.state === RecorderState.RECORDING) {
                                this._processAudioData(e.inputBuffer);
                            }
                        };
                        
                        console.log('AudioRecorder: Recorder initialized');
                        this.state = RecorderState.IDLE;
                        this._initializing = false;
                        this._emit('initialized');
                        resolve();
                    }).catch(err => {
                        console.error('AudioRecorder: Failed to get microphone permission:', err);
                        this.state = RecorderState.ERROR;
                        this._initializing = false;
                        
                        const error = new Error(err.message || '无法访问麦克风');
                        error.isUserNotAllow = err.name === 'NotAllowedError';
                        
                        this._emit('error', error);
                        reject(error);
                    });
                } catch (error) {
                    console.error('AudioRecorder: Error during initialization:', error);
                    this.state = RecorderState.ERROR;
                    this._initializing = false;
                    this._emit('error', error);
                    reject(error);
                }
            });
        }

        /**
         * 处理音频数据
         */
        _processAudioData(inputBuffer) {
            try {
                // 获取原始 PCM 数据 (Float32Array, 48kHz)
                const inputData = inputBuffer.getChannelData(0);
                
                // 重采样到 16kHz
                const resampledData = this._resample(inputData, 16000, this.config.sampleRate);
                
                // 转换为 Int16Array
                const int16Data = this._floatToInt16(resampledData);
                
                // 添加到缓冲，限制缓冲区大小防止内存溢出
                this.sampleBuffer.push(...int16Data);
                // 如果缓冲区过大，丢弃最旧的数据（保留最近30秒）
                if (this.sampleBuffer.length > this._maxBufferSize) {
                    this.sampleBuffer = this.sampleBuffer.slice(-this._maxBufferSize);
                }
                this.stats.totalSamples += int16Data.length;
                
                // 计算块大小 (chunkDuration ms 的数据)
                const chunkSize = Math.floor(this.config.sampleRate * this.config.chunkDuration / 1000);
                
                // 发送完整的数据块
                while (this.sampleBuffer.length >= chunkSize) {
                    const chunk = new Int16Array(this.sampleBuffer.slice(0, chunkSize));
                    this.sampleBuffer = this.sampleBuffer.slice(chunkSize);
                    
                    this.stats.chunksSent++;
                    
                    // 触发音频数据事件
                    this._emit('audioData', chunk);
                    
                    // 调用外部处理回调
                    if (this._onProcessCallback) {
                        try {
                            this._onProcessCallback(chunk);
                        } catch (error) {
                            console.error('AudioRecorder: Error in process callback:', error);
                        }
                    }
                }
                
                // 计算音量级别
                let sum = 0;
                for (let i = 0; i < int16Data.length; i++) {
                    sum += Math.abs(int16Data[i]);
                }
                const powerLevel = Math.min(100, Math.floor(sum / int16Data.length / 327.68));
                this._emit('volume', powerLevel);
                
            } catch (error) {
                console.error('AudioRecorder: Error processing audio data:', error);
            }
        }

        /**
         * 重采样
         */
        _resample(inputData, inputSampleRate, outputSampleRate) {
            if (inputSampleRate === outputSampleRate) {
                return inputData;
            }
            
            const ratio = inputSampleRate / outputSampleRate;
            const outputLength = Math.floor(inputData.length / ratio);
            const outputData = new Float32Array(outputLength);
            
            for (let i = 0; i < outputLength; i++) {
                const inputIndex = i * ratio;
                const index = Math.floor(inputIndex);
                const fraction = inputIndex - index;
                
                if (index + 1 < inputData.length) {
                    outputData[i] = inputData[index] * (1 - fraction) + inputData[index + 1] * fraction;
                } else {
                    outputData[i] = inputData[index];
                }
            }
            
            return outputData;
        }

        /**
         * Float32 转 Int16
         */
        _floatToInt16(floatData) {
            const int16Data = new Int16Array(floatData.length);
            for (let i = 0; i < floatData.length; i++) {
                // 将 -1.0 ~ 1.0 转换为 -32768 ~ 32767
                let sample = floatData[i] * 32767;
                // 限制范围
                sample = Math.max(-32768, Math.min(32767, sample));
                int16Data[i] = Math.round(sample);
            }
            return int16Data;
        }

        /**
         * 开始录音
         */
        async start() {
            if (this.state === RecorderState.RECORDING) {
                console.warn('AudioRecorder: Already recording');
                return;
            }

            if (this.state === RecorderState.ERROR) {
                throw new Error('录音器处于错误状态，请重新初始化');
            }

            if (!this.audioContext) {
                await this.init();
            }

            // 确保处于空闲状态
            if (this.state !== RecorderState.IDLE && this.state !== RecorderState.PAUSED) {
                throw new Error(`无法开始录音，当前状态: ${this.state}`);
            }

            try {
                // 重置缓冲和统计
                this.sampleBuffer = [];
                this.stats = {
                    startTime: Date.now(),
                    duration: 0,
                    totalSamples: 0,
                    chunksSent: 0
                };
                
                // 恢复 AudioContext（如果已被暂停）
                if (this.audioContext.state === 'suspended') {
                    await this.audioContext.resume();
                }

                this.state = RecorderState.RECORDING;
                
                console.log('AudioRecorder: Recording started');
                
                // 启动时长计时器
                this._startDurationTimer();
                
                // 设置最大录音时长限制
                this._maxDurationTimer = setTimeout(() => {
                    console.log('AudioRecorder: Max duration reached');
                    this._emit('maxDurationReached');
                    this.stop().catch(err => {
                        console.error('AudioRecorder: Error stopping after max duration:', err);
                    });
                }, this.config.maxDuration);
                
                this._emit('started');
            } catch (error) {
                console.error('AudioRecorder: Error starting recording:', error);
                this.state = RecorderState.ERROR;
                this._emit('error', error);
                throw error;
            }
        }

        /**
         * 停止录音
         */
        stop() {
            if (this.state === RecorderState.IDLE) {
                return Promise.resolve({
                    blob: null,
                    duration: 0,
                    stats: { ...this.stats }
                });
            }

            if (this.state === RecorderState.STOPPING) {
                return new Promise((resolve) => {
                    const checkStopped = () => {
                        if (this.state !== RecorderState.STOPPING) {
                            resolve({
                                blob: null,
                                duration: this.stats.duration,
                                stats: { ...this.stats }
                            });
                            return;
                        }
                        setTimeout(checkStopped, 50);
                    };
                    checkStopped();
                });
            }

            return new Promise((resolve, reject) => {
                this.state = RecorderState.STOPPING;
                
                // 清除定时器
                this._stopDurationTimer();
                if (this._maxDurationTimer) {
                    clearTimeout(this._maxDurationTimer);
                    this._maxDurationTimer = null;
                }

                // 发送剩余的缓冲数据
                if (this.sampleBuffer.length > 0) {
                    const remainingData = new Int16Array(this.sampleBuffer);
                    this._emit('audioData', remainingData);
                    this.sampleBuffer = [];
                }

                try {
                    const duration = Date.now() - this.stats.startTime;
                    this.stats.duration = duration;
                    
                    this.state = RecorderState.IDLE;
                    
                    console.log('AudioRecorder: Recording stopped, duration:', duration);
                    
                    this._emit('stopped', {
                        blob: null,
                        duration: duration,
                        stats: { ...this.stats }
                    });
                    
                    resolve({
                        blob: null,
                        duration: duration,
                        stats: { ...this.stats }
                    });
                } catch (error) {
                    console.error('AudioRecorder: Error stopping:', error);
                    this.state = RecorderState.ERROR;
                    this._emit('error', error);
                    reject(error);
                }
            });
        }

        /**
         * 启动时长计时器
         */
        _startDurationTimer() {
            this._stopDurationTimer();
            
            this._durationTimer = setInterval(() => {
                if (this.stats.startTime > 0) {
                    this.stats.duration = Date.now() - this.stats.startTime;
                    this._emit('durationUpdate', this.stats.duration);
                }
            }, 100);
        }

        /**
         * 停止时长计时器
         */
        _stopDurationTimer() {
            if (this._durationTimer) {
                clearInterval(this._durationTimer);
                this._durationTimer = null;
            }
        }

        /**
         * 获取当前状态
         */
        getState() {
            return {
                state: this.state,
                isRecording: this.state === RecorderState.RECORDING,
                isPaused: this.state === RecorderState.PAUSED,
                duration: this.stats.duration
            };
        }

        /**
         * 获取录音统计
         */
        getStats() {
            return { ...this.stats };
        }

        /**
         * 设置音频数据处理回调
         */
        setAudioProcessCallback(callback) {
            if (typeof callback !== 'function') {
                console.warn('AudioRecorder: Invalid callback provided');
                return;
            }
            this._onProcessCallback = callback;
        }

        /**
         * 关闭录音器并释放资源
         */
        close() {
            return new Promise((resolve) => {
                // 如果正在录音，先停止
                if (this.state === RecorderState.RECORDING || this.state === RecorderState.PAUSED) {
                    this.stop().then(() => {
                        this._doClose();
                        resolve();
                    }).catch(() => {
                        this._doClose();
                        resolve();
                    });
                } else {
                    this._doClose();
                    resolve();
                }
            });
        }

        /**
         * 执行关闭操作
         */
        _doClose() {
            // 清除定时器
            this._stopDurationTimer();
            if (this._maxDurationTimer) {
                clearTimeout(this._maxDurationTimer);
                this._maxDurationTimer = null;
            }

            // 断开音频节点
            if (this.scriptProcessor) {
                try {
                    this.scriptProcessor.disconnect();
                } catch (error) {
                    console.error('AudioRecorder: Error disconnecting script processor:', error);
                }
                this.scriptProcessor = null;
            }

            if (this.mediaStreamSource) {
                try {
                    this.mediaStreamSource.disconnect();
                } catch (error) {
                    console.error('AudioRecorder: Error disconnecting media stream source:', error);
                }
                this.mediaStreamSource = null;
            }

            // 停止媒体流
            if (this.mediaStream) {
                try {
                    this.mediaStream.getTracks().forEach(track => track.stop());
                } catch (error) {
                    console.error('AudioRecorder: Error stopping media stream:', error);
                }
                this.mediaStream = null;
            }

            // 关闭 AudioContext
            if (this.audioContext) {
                try {
                    this.audioContext.close();
                } catch (error) {
                    console.error('AudioRecorder: Error closing audio context:', error);
                }
                this.audioContext = null;
            }
            
            // 清空缓冲
            this.sampleBuffer = [];
            
            this.state = RecorderState.IDLE;
            this._initializing = false;
            this._emit('closed');
        }

        /**
         * 销毁录音器
         */
        destroy() {
            this.close().then(() => {
                this._listeners.clear();
                this._onProcessCallback = null;
            });
        }
    }

    // 导出到全局
    window.AudioRecorder = AudioRecorder;
    window.RecorderState = RecorderState;

})(window);
