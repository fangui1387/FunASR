/**
 * FunASR语音识别SDK - FunASRController
 * 提供独立的语音识别功能，不依赖特定UI
 * 
 * 使用示例:
 * const asr = new FunASRController({
 *     wsUrl: 'ws://192.168.1.17:10095/',
 *     mode: '2pass',
 *     itn: true
 * });
 * 
 * asr.onResult((result) => console.log(result.text));
 * asr.onComplete((result) => console.log('完成:', result.text));
 * asr.startRecording();
 */

(function(window) {
    'use strict';

    // 默认配置
    const DEFAULT_CONFIG = {
        wsUrl: 'ws://192.168.1.17:10095/',
        mode: 'offline',
        wavName: 'h5_recording',
        wavFormat: 'pcm',
        audioFs: 16000,
        itn: true,
        hotwords: null
    };

    /**
     * FunASR语音识别控制器
     * 核心功能：WebSocket连接、音频录制、识别结果处理
     */
    class FunASRController {
        constructor(options = {}) {
            this.config = { ...DEFAULT_CONFIG, ...options };
            
            // 核心模块
            this.wsClient = null;
            this.audioRecorder = null;
            
            // 状态
            this._isRecording = false;
            this._isInitialized = false;
            
            // 识别结果存储
            this.results = [];
            this.currentText = '';
            
            // 多句识别状态（用于2pass/online模式）
            this.completedSentences = [];
            this.currentSentence = '';
            
            // 事件监听器
            this._listeners = {
                result: [],
                complete: [],
                error: [],
                start: [],
                stop: [],
                connecting: [],
                connected: [],
                disconnected: []
            };

            // 初始化
            this._initPromise = this._init();
        }

        /**
         * 初始化SDK
         */
        async _init() {
            try {
                // 初始化WebSocket客户端
                this.wsClient = new WSClient({
                    url: this.config.wsUrl,
                    mode: this.config.mode
                });
                
                // 绑定WebSocket事件
                this._bindWSClientEvents();
                
                // 初始化音频录制器
                this.audioRecorder = new AudioRecorder({
                    sampleRate: this.config.audioFs,
                    bufferSize: 4096,
                    chunkDuration: 100,
                    maxDuration: 60000
                });
                
                // 绑定音频录制器事件
                this._bindAudioRecorderEvents();
                
                this._isInitialized = true;
                console.log('FunASRController: Initialized successfully');
            } catch (error) {
                console.error('FunASRController: Initialization failed:', error);
                this._emit('error', error);
            }
        }

        /**
         * 绑定WebSocket客户端事件
         */
        _bindWSClientEvents() {
            if (!this.wsClient) return;

            this.wsClient.on('connecting', () => {
                this._emit('connecting');
            });

            this.wsClient.on('connected', () => {
                this._emit('connected');
            });

            this.wsClient.on('disconnected', () => {
                this._emit('disconnected');
            });

            this.wsClient.on('error', (error) => {
                this._emit('error', error);
            });

            this.wsClient.on('result', (result) => {
                this._handleRecognitionResult(result);
            });

            this.wsClient.on('complete', (result) => {
                this._handleRecognitionComplete(result);
            });
        }

        /**
         * 绑定音频录制器事件
         */
        _bindAudioRecorderEvents() {
            if (!this.audioRecorder) return;

            this.audioRecorder.on('started', () => {
                this._isRecording = true;
                this._emit('start');
            });

            this.audioRecorder.on('stopped', () => {
                this._isRecording = false;
                this._emit('stop');
            });

            this.audioRecorder.on('audioData', (data) => {
                if (this.wsClient && this.wsClient.getState().connected) {
                    this.wsClient.sendAudio(data);
                }
            });

            this.audioRecorder.on('error', (error) => {
                this._emit('error', error);
            });
        }

        /**
     * 处理识别结果
     */
    _handleRecognitionResult(result) {
        const newText = result.text || '';
        const mode = result.mode || '';
        // 2pass模式下，只有mode为'2pass-offline'时才表示句子结束
        // 不依赖result.isFinal，因为服务器可能在2pass-online模式下也设置is_final
        const isSentenceEnd = mode === '2pass-offline';

        console.log('[FunASRController Debug] ========== _handleRecognitionResult ==========');
        console.log('[FunASRController Debug] newText:', newText);
        console.log('[FunASRController Debug] result.mode:', result.mode);
        console.log('[FunASRController Debug] this.config.mode:', this.config.mode);
        console.log('[FunASRController Debug] isSentenceEnd:', isSentenceEnd);
        console.log('[FunASRController Debug] completedSentences:', this.completedSentences);
        console.log('[FunASRController Debug] currentSentence:', this.currentSentence);

        // 更新当前文本
        this.currentText = newText;

        // 2pass/online模式：处理多句识别
        if (this.config.mode === '2pass' || this.config.mode === 'online') {
            if (isSentenceEnd) {
                // 句子结束，保存到已完成列表
                // 服务器返回的是完整句子文本
                this.completedSentences.push(newText);
                this.currentSentence = '';
                console.log('[FunASRController Debug] 句子结束，已保存到completedSentences');
            } else {
                // 中间结果，增量添加到当前句子
                // 服务器返回的是增量文本
                this.currentSentence += newText;
                console.log('[FunASRController Debug] 中间结果，增量更新currentSentence:', this.currentSentence);
            }

            // 拼接完整文本：已完成的句子 + 当前正在识别的句子
            result.fullText = this.completedSentences.join('') + this.currentSentence;
            console.log('[FunASRController Debug] fullText:', result.fullText);
        } else {
            // offline模式：直接显示
            result.fullText = newText;
        }

        this._emit('result', result);
    }

        /**
         * 处理识别完成（句子结束）
         * 在2pass模式下，只有mode为'2pass-offline'时才会触发
         */
        _handleRecognitionComplete(result) {
            const finalText = result.text || '';
            
            // 保存结果
            this.results.push(result);
            
            // 2pass/online模式：使用服务器返回的最终结果
            if (this.config.mode === '2pass' || this.config.mode === 'online') {
                if (finalText) {
                    result.fullText = finalText;
                }
                
                // 注意：不在此处重置多句识别状态
                // 因为2pass模式下，complete只表示一个句子结束，不是整个录音结束
                // 状态重置应该在开始新的录音时进行（startRecording中）
            }
            
            this._emit('complete', result);
        }

        /**
         * 注册事件监听器
         */
        on(event, callback) {
            if (this._listeners[event]) {
                this._listeners[event].push(callback);
            }
            return () => {
                const index = this._listeners[event].indexOf(callback);
                if (index > -1) {
                    this._listeners[event].splice(index, 1);
                }
            };
        }

        /**
         * 触发事件
         */
        _emit(event, data) {
            const listeners = this._listeners[event];
            if (listeners) {
                listeners.forEach(callback => {
                    try {
                        callback(data);
                    } catch (error) {
                        console.error(`FunASRController: Error in ${event} listener:`, error);
                    }
                });
            }
        }

        // ========== 便捷的事件绑定方法 ==========

        onResult(callback) {
            return this.on('result', callback);
        }

        onComplete(callback) {
            return this.on('complete', callback);
        }

        onError(callback) {
            return this.on('error', callback);
        }

        onStart(callback) {
            return this.on('start', callback);
        }

        onStop(callback) {
            return this.on('stop', callback);
        }

        onConnecting(callback) {
            return this.on('connecting', callback);
        }

        onConnected(callback) {
            return this.on('connected', callback);
        }

        onDisconnected(callback) {
            return this.on('disconnected', callback);
        }

        // ========== 核心API方法 ==========

        /**
         * 连接到服务器
         */
        async connect(params = {}) {
            if (!this._isInitialized) {
                throw new Error('SDK未初始化完成');
            }

            const connectionParams = {
                mode: params.mode || this.config.mode,
                wavName: params.wavName || this.config.wavName,
                wavFormat: params.wavFormat || this.config.wavFormat,
                audioFs: params.audioFs || this.config.audioFs,
                itn: params.itn !== undefined ? params.itn : this.config.itn,
                hotwords: params.hotwords || this.config.hotwords
            };

            return this.wsClient.connect(connectionParams);
        }

        /**
         * 断开连接
         */
        disconnect() {
            if (this.wsClient) {
                this.wsClient.disconnect();
            }
        }

        /**
         * 开始录音
         */
        async startRecording(params = {}) {
            // 等待初始化完成
            if (this._initPromise) {
                await this._initPromise;
            }
            
            if (!this._isInitialized) {
                throw new Error('SDK未初始化完成');
            }

            if (this._isRecording) {
                throw new Error('录音已在进行中');
            }

            // 如果未连接，先连接
            if (!this.wsClient.getState().connected) {
                await this.connect(params);
            }

            // 发送配置参数到服务器
            // 这是为了确保服务器收到 mode 参数后再开始处理音频数据
            const configMessage = {
                mode: this.config.mode,
                wav_name: this.config.wavName,
                wav_format: this.config.wavFormat,
                audio_fs: this.config.audioFs,
                is_speaking: true,
                itn: this.config.itn,
                hotwords: this.config.hotwords
            };
            const sent = this.wsClient._sendJson(configMessage);
            console.log('[FunASRController Debug] Sent config:', JSON.stringify(configMessage), 'result:', sent);

            // 清空之前的结果
            this.completedSentences = [];
            this.currentSentence = '';
            this.currentText = '';

            // 开始录音
            await this.audioRecorder.start();
        }

        /**
         * 停止录音
         */
        async stopRecording() {
            if (!this._isRecording) {
                return;
            }

            // 停止录音
            await this.audioRecorder.stop();

            // 发送结束信号
            if (this.wsClient && this.wsClient.getState().connected) {
                this.wsClient.sendEndSignal();
            }
        }

        // ========== 配置管理 ==========

        /**
         * 设置识别模式
         */
        setMode(mode) {
            this.config.mode = mode;
            if (this.wsClient) {
                this.wsClient.updateConfig({ mode });
            }
        }

        /**
         * 设置WebSocket地址
         */
        setUrl(url) {
            this.config.wsUrl = url;
            if (this.wsClient) {
                this.wsClient.updateConfig({ url });
            }
        }

        /**
         * 更新配置
         */
        updateConfig(config) {
            this.config = { ...this.config, ...config };
            if (this.wsClient) {
                this.wsClient.updateConfig(config);
            }
        }

        // ========== 状态获取 ==========

        /**
         * 是否正在录音
         */
        isRecording() {
            return this._isRecording;
        }

        /**
         * 是否已连接
         */
        isConnected() {
            return this.wsClient && this.wsClient.getState().connected;
        }

        /**
         * 获取所有识别结果
         */
        getResults() {
            return [...this.results];
        }

        /**
         * 获取当前识别文本
         */
        getCurrentText() {
            return this.currentText;
        }

        /**
         * 清空识别结果
         */
        clearResults() {
            this.results = [];
            this.currentText = '';
            this.completedSentences = [];
            this.currentSentence = '';
            if (this.wsClient) {
                this.wsClient.clearResults();
            }
        }

        // ========== 销毁 ==========

        /**
         * 销毁SDK
         */
        destroy() {
            this.stopRecording();
            
            if (this.audioRecorder) {
                this.audioRecorder.destroy();
                this.audioRecorder = null;
            }

            if (this.wsClient) {
                this.wsClient.destroy();
                this.wsClient = null;
            }

            // 清空监听器
            Object.keys(this._listeners).forEach(key => {
                this._listeners[key] = [];
            });

            this._isInitialized = false;
            console.log('FunASRController: Destroyed');
        }
    }

    // 导出到全局
    window.FunASRController = FunASRController;

})(window);
