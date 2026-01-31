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
            // 参数验证
            if (options !== null && typeof options !== 'object') {
                throw new TypeError('FunASRController: options must be an object');
            }

            this.config = { ...DEFAULT_CONFIG, ...(options || {}) };
            
            // 验证必要配置
            this._validateConfig();

            // 初始化核心辅助模块
            // StateManager: 统一管理录音、连接和应用状态
            this.stateManager = new StateManager();
            // ErrorHandler: 统一处理错误和环境检查
            this.errorHandler = new ErrorHandler({
                showToast: false, // UI显示由外部控制
                logErrors: true
            });

            // 绑定错误处理器的事件监听，将标准化后的错误抛出给上层
            this.errorHandler.on('*', (error) => {
                this._emit('error', error);
            });

            // 核心模块
            this.wsClient = null;
            this.audioRecorder = null;
            
            // 识别结果存储
            this.results = [];
            this.currentText = '';
            this._maxResultsSize = 1000; // 最大结果数限制，防止内存溢出

            // 多句识别状态（用于2pass/online模式）
            this.completedSentences = [];
            this.currentSentence = '';
            this._maxSentencesSize = 500; // 最大句子数限制
            
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
         * 验证配置参数
         * @private
         */
        _validateConfig() {
            const validModes = ['offline', 'online', '2pass'];
            if (!validModes.includes(this.config.mode)) {
                console.warn(`FunASRController: Invalid mode "${this.config.mode}", using default "offline"`);
                this.config.mode = 'offline';
            }

            if (typeof this.config.audioFs !== 'number' || this.config.audioFs <= 0) {
                console.warn(`FunASRController: Invalid audioFs "${this.config.audioFs}", using default 16000`);
                this.config.audioFs = 16000;
            }

            if (!this.config.wsUrl || typeof this.config.wsUrl !== 'string') {
                throw new Error('FunASRController: wsUrl is required and must be a string');
            }
        }

        /**
         * 检查实例是否已被销毁
         * @private
         */
        _checkDestroyed() {
            if (!this.stateManager) {
                throw new Error('FunASRController: Instance has been destroyed');
            }
        }

        /**
         * 初始化SDK
         */
        async _init() {
            try {
                this.stateManager.setAppState(AppState.INITIALIZING);

                // 检查浏览器环境支持 (使用 ErrorHandler 的能力)
                const support = this.errorHandler.checkBrowserSupport();
                
                // 输出警告信息
                if (support.warnings && support.warnings.length > 0) {
                    support.warnings.forEach(warning => {
                        console.warn('FunASRController Warning:', warning.message);
                    });
                }

                // 如果有严重错误且处于严格模式（或者缺少核心功能WebSocket）
                if (support.errors && support.errors.length > 0) {
                    const criticalError = support.errors.find(e => e.type === ErrorType.BROWSER_NOT_SUPPORTED);
                    if (criticalError) {
                        throw new Error(criticalError.message);
                    }
                }

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
                
                this.stateManager.setAppState(AppState.READY);
                console.log('FunASRController: Initialized successfully');
            } catch (error) {
                this.stateManager.setAppState(AppState.ERROR);
                console.error('FunASRController: Initialization failed:', error);
                this.errorHandler.handle(error, { phase: 'initialization' });
                // 初始化失败时清理资源
                this._cleanupOnInitFailure();
            }
        }

        /**
         * 初始化失败时清理资源
         * @private
         */
        _cleanupOnInitFailure() {
            if (this.wsClient) {
                try {
                    this.wsClient.destroy();
                } catch (e) { /* ignore */ }
                this.wsClient = null;
            }
            if (this.audioRecorder) {
                try {
                    this.audioRecorder.destroy();
                } catch (e) { /* ignore */ }
                this.audioRecorder = null;
            }
        }

        /**
         * 绑定WebSocket客户端事件
         */
        _bindWSClientEvents() {
            if (!this.wsClient) return;

            this.wsClient.on('connecting', () => {
                this.stateManager.setConnectionState(ConnectionState.CONNECTING);
                this._emit('connecting');
            });

            this.wsClient.on('connected', () => {
                this.stateManager.setConnectionState(ConnectionState.CONNECTED);
                this._emit('connected');
            });

            this.wsClient.on('disconnected', () => {
                this.stateManager.setConnectionState(ConnectionState.DISCONNECTED);
                this._emit('disconnected');
            });

            this.wsClient.on('error', (error) => {
                this.stateManager.setConnectionState(ConnectionState.ERROR);
                // 委托给 ErrorHandler 处理，它会通过事件冒泡触发 this._emit('error')
                this.errorHandler.handle(error, { source: 'WebSocket' });
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
                this.stateManager.setRecordingState(RecordingState.RECORDING);
                this._emit('start');
            });

            this.audioRecorder.on('stopped', () => {
                this.stateManager.setRecordingState(RecordingState.IDLE);
                this._emit('stop');
            });

            this.audioRecorder.on('audioData', (data) => {
                // 使用 stateManager 检查连接状态
                if (this.wsClient && this.stateManager.isConnected) {
                    this.wsClient.sendAudio(data);
                }
            });

            this.audioRecorder.on('error', (error) => {
                // 委托给 ErrorHandler 处理
                this.errorHandler.handle(error, { source: 'AudioRecorder' });
            });
        }

        /**
         * 处理识别结果
         * @param {Object} result - 识别结果对象
         */
        _handleRecognitionResult(result) {
            try {
                // 参数验证
                if (!result || typeof result !== 'object') {
                    console.warn('FunASRController: Invalid result received', result);
                    return;
                }

                const newText = result.text || '';
                const mode = result.mode || '';
                const isSentenceEnd = mode === '2pass-offline';

                // 更新当前文本
                this.currentText = newText;

                // 2pass/online模式：处理多句识别
                if (this.config.mode === '2pass' || this.config.mode === 'online') {
                    if (isSentenceEnd) {
                        this.completedSentences.push(newText);
                        if (this.completedSentences.length > this._maxSentencesSize) {
                            this.completedSentences = this.completedSentences.slice(-this._maxSentencesSize);
                        }
                        this.currentSentence = '';
                    } else {
                        this.currentSentence += newText;
                    }
                    result.fullText = this.completedSentences.join('') + this.currentSentence;
                } else {
                    result.fullText = newText;
                }

                this._emit('result', result);
            } catch (error) {
                console.error('FunASRController: Error handling recognition result:', error);
                this.errorHandler.handle(error, { phase: 'handleResult' });
            }
        }

        /**
         * 处理识别完成（句子结束）
         */
        _handleRecognitionComplete(result) {
            try {
                if (!result || typeof result !== 'object') {
                    console.warn('FunASRController: Invalid complete result received', result);
                    return;
                }

                const finalText = result.text || '';

                this.results.push(result);
                if (this.results.length > this._maxResultsSize) {
                    this.results = this.results.slice(-this._maxResultsSize);
                }
                
                if (this.config.mode === '2pass' || this.config.mode === 'online') {
                    if (finalText) {
                        result.fullText = finalText;
                    }
                }
                
                this._emit('complete', result);
            } catch (error) {
                console.error('FunASRController: Error handling recognition complete:', error);
                this.errorHandler.handle(error, { phase: 'handleComplete' });
            }
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

        onResult(callback) { return this.on('result', callback); }
        onComplete(callback) { return this.on('complete', callback); }
        onError(callback) { return this.on('error', callback); }
        onStart(callback) { return this.on('start', callback); }
        onStop(callback) { return this.on('stop', callback); }
        onConnecting(callback) { return this.on('connecting', callback); }
        onConnected(callback) { return this.on('connected', callback); }
        onDisconnected(callback) { return this.on('disconnected', callback); }

        // ========== 核心API方法 ==========

        /**
         * 连接到服务器
         */
        async connect(params = {}) {
            this._checkDestroyed();

            if (!this.stateManager.isReady) {
                 // 等待初始化（如果还在进行中）
                 if (this._initPromise) {
                     await this._initPromise;
                 }
                 if (!this.stateManager.isReady) {
                    throw new Error('SDK未就绪或初始化失败');
                 }
            }

            // 使用 stateManager 检查是否允许连接
            // 注意：这里我们允许在任何非CONNECTED状态下尝试连接，所以不严格检查 canPerform('connect')
            // 因为 wsClient 内部会处理状态

            if (!this.wsClient) {
                throw new Error('WebSocket client not initialized');
            }

            const connectionParams = {
                mode: params.mode || this.config.mode,
                wavName: params.wavName || this.config.wavName,
                wavFormat: params.wavFormat || this.config.wavFormat,
                audioFs: params.audioFs || this.config.audioFs,
                itn: params.itn !== undefined ? params.itn : this.config.itn,
                hotwords: params.hotwords || this.config.hotwords
            };

            try {
                return await this.wsClient.connect(connectionParams);
            } catch (error) {
                // error is already handled by wsClient 'error' event -> errorHandler
                throw error;
            }
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
            this._checkDestroyed();

            try {
                if (this._initPromise) {
                    await this._initPromise;
                }
                
                if (!this.stateManager.isReady && !this.stateManager.isConnected) {
                     // 允许在未连接状态下调用，下面会尝试连接
                } else if (this.stateManager.appState === AppState.ERROR) {
                    throw new Error('SDK处于错误状态，无法开始录音');
                }

                // 使用 stateManager 检查是否已经在录音
                if (this.stateManager.isRecording) {
                    throw new Error('录音已在进行中');
                }

                if (!this.wsClient || !this.audioRecorder) {
                    throw new Error('核心模块未初始化');
                }

                // 如果未连接，先连接
                if (!this.stateManager.isConnected) {
                    await this.connect(params);
                }

                // 发送配置参数
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
                if (!sent) {
                    throw new Error('Failed to send configuration to server');
                }

                // 清空之前的结果
                this.completedSentences = [];
                this.currentSentence = '';
                this.currentText = '';

                // 开始录音
                await this.audioRecorder.start();
            } catch (error) {
                this.errorHandler.handle(error, { phase: 'startRecording' });
                throw error;
            }
        }

        /**
         * 停止录音
         */
        async stopRecording() {
            this._checkDestroyed();

            if (!this.stateManager.isRecording) {
                return;
            }

            try {
                // 停止录音
                if (this.audioRecorder) {
                    await this.audioRecorder.stop();
                }

                // 发送结束信号
                if (this.wsClient && this.stateManager.isConnected) {
                    this.wsClient.sendEndSignal();
                }
            } catch (error) {
                this.errorHandler.handle(error, { phase: 'stopRecording' });
                // 强制重置状态以防万一
                this.stateManager.setRecordingState(RecordingState.IDLE);
                throw error;
            }
        }

        // ========== 配置管理 ==========

        setMode(mode) {
            this.config.mode = mode;
            if (this.wsClient) {
                this.wsClient.updateConfig({ mode });
            }
        }

        setUrl(url) {
            this.config.wsUrl = url;
            if (this.wsClient) {
                this.wsClient.updateConfig({ url });
            }
        }

        updateConfig(config) {
            this.config = { ...this.config, ...config };
            if (this.wsClient) {
                this.wsClient.updateConfig(config);
            }
        }

        // ========== 状态获取 ==========

        isRecording() {
            return this.stateManager ? this.stateManager.isRecording : false;
        }

        isConnected() {
            return this.stateManager ? this.stateManager.isConnected : false;
        }

        getResults() {
            return [...this.results];
        }

        getCurrentText() {
            return this.currentText;
        }

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

        destroy() {
            if (!this.stateManager) {
                return;
            }

            try {
                // 停止录音
                if (this.isRecording()) {
                    this.stopRecording().catch(e => console.warn(e));
                }
                
                if (this.audioRecorder) {
                    this.audioRecorder.destroy();
                    this.audioRecorder = null;
                }

                if (this.wsClient) {
                    this.wsClient.destroy();
                    this.wsClient = null;
                }

                // 销毁管理器
                if (this.errorHandler) {
                    this.errorHandler.destroy();
                    this.errorHandler = null;
                }
                
                if (this.stateManager) {
                    this.stateManager.destroy();
                    this.stateManager = null;
                }

                // 清空监听器
                Object.keys(this._listeners).forEach(key => {
                    this._listeners[key] = [];
                });

                console.log('FunASRController: Destroyed');
            } catch (error) {
                console.error('FunASRController: Error during destroy:', error);
            }
        }
    }

    // 导出到全局
    window.FunASRController = FunASRController;

})(window);
