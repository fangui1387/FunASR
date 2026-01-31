/**
 * 应用入口 / 视图层
 * 负责UI交互、模块协调和业务逻辑整合
 */

(function(window) {
    'use strict';

    /**
     * 语音识别应用类
     */
    class ASRApp {
        constructor() {
            // 初始化模块
            this.stateManager = null;
            this.errorHandler = null;
            this.wsClient = null;
            this.audioRecorder = null;

            // DOM元素缓存
            this.elements = {};

            // 多句语音识别结果存储
            this.completedSentences = []; // 已完成的句子列表
            this.currentSentence = '';    // 当前正在识别的句子
            this.recognitionText = '';    // 完整展示文本（completed + current）
            this.isRecording = false;
            this.recordingStartTime = 0;
            this.durationTimer = null;

            // 防止重复初始化
            this._initialized = false;
            this._initializing = false;

            // 页面可见性状态
            this._wasRecordingBeforeHidden = false;

            // 绑定方法
            this._bindMethods();
        }

        /**
         * 绑定方法到实例
         */
        _bindMethods() {
            this._handleRecordStart = this._handleRecordStart.bind(this);
            this._handleRecordEnd = this._handleRecordEnd.bind(this);
            this._updateRecordingTime = this._updateRecordingTime.bind(this);
            this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
            this._handleOnline = this._handleOnline.bind(this);
            this._handleOffline = this._handleOffline.bind(this);
            this._handleBeforeUnload = this._handleBeforeUnload.bind(this);
        }

        /**
         * 初始化应用
         */
        async init() {
            // 防止重复初始化
            if (this._initialized || this._initializing) {
                console.log('ASRApp: Already initialized or initializing');
                return;
            }

            this._initializing = true;

            try {
                console.log('ASRApp: Initializing...');

                // 缓存DOM元素
                this._cacheElements();

                // 检查DOM元素是否都存在
                if (!this._validateElements()) {
                    throw new Error('部分DOM元素未找到，请检查HTML结构');
                }

                // 初始化错误处理器
                this.errorHandler = new ErrorHandler();

                // 检查浏览器支持（宽松模式）
                const browserCheck = this.errorHandler.checkBrowserSupport();
                
                // 显示错误（阻止运行的错误）
                if (browserCheck.errors && browserCheck.errors.length > 0) {
                    browserCheck.errors.forEach(error => {
                        this.errorHandler.handle(error);
                    });
                    this._initializing = false;
                    return;
                }
                
                // 显示警告（非阻塞性警告）
                if (browserCheck.warnings && browserCheck.warnings.length > 0) {
                    console.warn('ASRApp: Browser compatibility warnings:', browserCheck.warnings);
                    // 延迟显示警告，避免初始化时弹窗过多
                    setTimeout(() => {
                        browserCheck.warnings.forEach(warning => {
                            // 使用console.warn而不是toast，避免打扰用户
                            console.warn(`[ASRApp Warning] ${warning.type}: ${warning.message}`);
                        });
                    }, 2000);
                }

                // 初始化状态管理器
                this.stateManager = new StateManager();

                // 绑定事件
                this._bindEvents();

                // 绑定状态监听
                this._bindStateListeners();

                // 绑定错误恢复
                this._bindErrorRecovery();

                // 初始化WebSocket客户端，使用offline模式（默认）
                this.wsClient = new WSClient({
                    url: this.elements.wsUrl.value,
                    mode: 'offline'
                });
                this._bindWSClientEvents();

                // 初始化音频录制器
                this.audioRecorder = new AudioRecorder();
                this._bindAudioRecorderEvents();

                // 绑定页面生命周期事件
                this._bindLifecycleEvents();

                // 尝试自动连接
                await this._tryAutoConnect();

                this._initialized = true;
                console.log('ASRApp: Initialized successfully');
            } catch (error) {
                console.error('ASRApp: Initialization failed:', error);
                this.errorHandler.handle(error, { context: 'initialization' });
            } finally {
                this._initializing = false;
            }
        }

        /**
         * 缓存DOM元素
         */
        _cacheElements() {
            this.elements = {
                // 配置面板
                configPanel: document.getElementById('configPanel'),
                configContent: document.getElementById('configContent'),
                toggleConfigBtn: document.getElementById('toggleConfigBtn'),
                wsUrl: document.getElementById('wsUrl'),
                recognitionMode: document.getElementById('recognitionMode'),
                hotwords: document.getElementById('hotwords'),
                useItn: document.getElementById('useItn'),
                testConnectionBtn: document.getElementById('testConnectionBtn'),
                resetConfigBtn: document.getElementById('resetConfigBtn'),

                // 状态栏
                statusBar: document.getElementById('statusBar'),
                statusIndicator: document.getElementById('statusIndicator'),
                statusText: document.getElementById('statusText'),

                // 结果面板
                resultContent: document.getElementById('resultContent'),
                resultMeta: document.getElementById('resultMeta'),
                clearResultBtn: document.getElementById('clearResultBtn'),

                // 录音面板
                recordPanel: document.getElementById('recordPanel'),
                recordIdle: document.getElementById('recordIdle'),
                recordActive: document.getElementById('recordActive'),
                recordBtn: document.getElementById('recordBtn'),
                recordStopBtn: document.getElementById('recordStopBtn'),
                recordingTime: document.getElementById('recordingTime'),

                // 错误提示
                errorToast: document.getElementById('errorToast'),
                errorMessage: document.getElementById('errorMessage'),
                errorCloseBtn: document.getElementById('errorCloseBtn'),

                // 加载遮罩
                loadingMask: document.getElementById('loadingMask')
            };
        }

        /**
         * 验证DOM元素是否存在
         */
        _validateElements() {
            const requiredElements = [
                'wsUrl', 'recordBtn', 'recordStopBtn', 'recordIdle', 'recordActive',
                'recordingTime', 'resultContent', 'statusIndicator', 'statusText'
            ];

            for (const key of requiredElements) {
                if (!this.elements[key]) {
                    console.error(`ASRApp: Required element '${key}' not found`);
                    return false;
                }
            }
            return true;
        }

        /**
         * 绑定UI事件
         */
        _bindEvents() {
            // 配置面板切换 - 同时支持click和touch事件
            if (this.elements.toggleConfigBtn && this.elements.configContent) {
                const toggleHandler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.elements.configContent.classList.toggle('expanded');
                    console.log('Config panel toggled, expanded:', this.elements.configContent.classList.contains('expanded'));
                };
                
                this.elements.toggleConfigBtn.addEventListener('click', toggleHandler);
                this.elements.toggleConfigBtn.addEventListener('touchstart', toggleHandler, { passive: false });
                
                // 添加视觉反馈
                this.elements.toggleConfigBtn.addEventListener('touchstart', () => {
                    this.elements.toggleConfigBtn.style.background = 'rgba(255, 255, 255, 0.3)';
                }, { passive: true });
                this.elements.toggleConfigBtn.addEventListener('touchend', () => {
                    this.elements.toggleConfigBtn.style.background = '';
                }, { passive: true });
            }

            // 测试连接按钮
            if (this.elements.testConnectionBtn) {
                this.elements.testConnectionBtn.addEventListener('click', () => {
                    this._testConnection();
                });
            }

            // 重置配置按钮
            if (this.elements.resetConfigBtn) {
                this.elements.resetConfigBtn.addEventListener('click', () => {
                    this._resetConfig();
                });
            }

            // 清空结果按钮
            if (this.elements.clearResultBtn) {
                this.elements.clearResultBtn.addEventListener('click', () => {
                    this._clearResults();
                });
            }

            // 录音按钮 - 点击开始录音
            if (this.elements.recordBtn) {
                this.elements.recordBtn.addEventListener('click', this._handleRecordStart);
            }

            // 停止录音按钮
            if (this.elements.recordStopBtn) {
                this.elements.recordStopBtn.addEventListener('click', this._handleRecordEnd);
            }

            // WebSocket地址变更
            if (this.elements.wsUrl) {
                this.elements.wsUrl.addEventListener('change', () => {
                    if (this.wsClient) {
                        this.wsClient.updateConfig({ url: this.elements.wsUrl.value });
                    }
                });
            }

            // 识别模式变更
            if (this.elements.recognitionMode) {
                this.elements.recognitionMode.addEventListener('change', () => {
                    const mode = this.elements.recognitionMode.value;
                    console.log('ASRApp: Recognition mode changed to:', mode);
                    
                    if (this.wsClient) {
                        this.wsClient.updateConfig({ mode: mode });
                    }
                    
                    // 显示模式切换提示
                    const modeNames = {
                        'offline': '离线模式',
                        '2pass': '两遍模式',
                        'online': '实时模式'
                    };
                    this._showToast(`已切换到${modeNames[mode] || mode}`);
                });
            }
        }

        /**
         * 绑定页面生命周期事件
         */
        _bindLifecycleEvents() {
            // 页面可见性变化
            if (typeof document.hidden !== 'undefined') {
                document.addEventListener('visibilitychange', this._handleVisibilityChange);
            }

            // 网络状态变化
            window.addEventListener('online', this._handleOnline);
            window.addEventListener('offline', this._handleOffline);

            // 页面关闭前清理资源
            window.addEventListener('beforeunload', this._handleBeforeUnload);
        }

        /**
         * 处理页面可见性变化
         */
        _handleVisibilityChange() {
            if (document.hidden) {
                // 页面隐藏时，如果正在录音，暂停录音
                if (this.isRecording) {
                    this._wasRecordingBeforeHidden = true;
                    this._pauseRecording();
                }
            } else {
                // 页面显示时，如果之前正在录音，恢复录音
                if (this._wasRecordingBeforeHidden) {
                    this._wasRecordingBeforeHidden = false;
                    // 可以选择恢复录音或停止录音
                    // this._resumeRecording();
                }
            }
        }

        /**
         * 处理网络恢复
         */
        _handleOnline() {
            console.log('ASRApp: Network is online');
            if (this.wsClient && !this.wsClient.getState().connected) {
                this._tryAutoConnect();
            }
        }

        /**
         * 处理网络断开
         */
        _handleOffline() {
            console.log('ASRApp: Network is offline');
            this._showError('网络已断开，请检查网络连接');
        }

        /**
         * 处理页面关闭
         */
        _handleBeforeUnload() {
            // 清理资源
            this.destroy();
        }

        /**
         * 暂停录音
         */
        _pauseRecording() {
            if (this.audioRecorder && this.isRecording) {
                this.audioRecorder.pause();
            }
        }

        /**
         * 恢复录音
         */
        _resumeRecording() {
            if (this.audioRecorder && this.audioRecorder.getState().isPaused) {
                this.audioRecorder.resume();
            }
        }

        /**
         * 绑定状态监听
         */
        _bindStateListeners() {
            if (!this.stateManager) return;

            // 连接状态变更
            this.stateManager.on('connectionChange', ({ state }) => {
                this._updateConnectionUI(state);
            });

            // 录音状态变更
            this.stateManager.on('recordingChange', ({ state }) => {
                this._updateRecordingUI(state);
            });

            // 应用状态变更
            this.stateManager.on('appStateChange', ({ state }) => {
                this._updateAppUI(state);
            });
        }

        /**
         * 绑定错误恢复
         */
        _bindErrorRecovery() {
            if (!this.errorHandler) return;

            this.errorHandler.on('recovery', ({ error, retryCount }) => {
                console.log(`ASRApp: Attempting recovery for ${error.type}, attempt ${retryCount}`);

                if (error.type === 'websocket_error' || error.type === 'network_error') {
                    this._tryAutoConnect();
                }
            });
        }

        /**
         * 绑定WebSocket客户端事件
         */
        _bindWSClientEvents() {
            if (!this.wsClient) return;

            this.wsClient.on('connecting', () => {
                if (this.stateManager) {
                    this.stateManager.setConnectionState(ConnectionState.CONNECTING);
                }
                this._showLoading('正在连接服务器...');
            });

            this.wsClient.on('connected', () => {
                if (this.stateManager) {
                    this.stateManager.setConnectionState(ConnectionState.CONNECTED);
                }
                this._hideLoading();
                if (this.errorHandler) {
                    this.errorHandler.resetRetryCount('websocket_error');
                    this.errorHandler.resetRetryCount('network_error');
                }
            });

            this.wsClient.on('error', (error) => {
                if (this.stateManager) {
                    this.stateManager.setConnectionState(ConnectionState.ERROR);
                }
                this._hideLoading();
                if (this.errorHandler) {
                    this.errorHandler.handle(error, { context: 'websocket' });
                }
            });

            this.wsClient.on('close', () => {
                if (this.stateManager) {
                    this.stateManager.setConnectionState(ConnectionState.DISCONNECTED);
                }
                this._hideLoading();
                console.log('ASRApp: WebSocket connection closed');
            });

            this.wsClient.on('reconnecting', ({ attempt }) => {
                console.log(`ASRApp: WebSocket reconnecting, attempt ${attempt}`);
                this._showLoading(`连接断开，正在重新连接(${attempt})...`);
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

            this.audioRecorder.on('initialized', () => {
                console.log('ASRApp: Audio recorder initialized');
            });

            this.audioRecorder.on('started', () => {
                if (this.stateManager) {
                    this.stateManager.setRecordingState(RecordingState.RECORDING);
                }
            });

            this.audioRecorder.on('stopped', () => {
                if (this.stateManager) {
                    this.stateManager.setRecordingState(RecordingState.IDLE);
                }
            });

            this.audioRecorder.on('audioData', (data) => {
                // 发送音频数据到WebSocket
                if (this.wsClient && this.wsClient.getState().connected) {
                    const sent = this.wsClient.sendAudio(data);
                    if (!sent) {
                        console.warn('ASRApp: Failed to send audio data');
                    }
                } else {
                    console.warn('ASRApp: WebSocket not connected, cannot send audio');
                }
            });

            this.audioRecorder.on('durationUpdate', (duration) => {
                this._updateRecordingTime(duration);
            });

            this.audioRecorder.on('error', (error) => {
                if (this.errorHandler) {
                    this.errorHandler.handle(error, { context: 'recorder' });
                }
                this._stopRecording();
            });

            this.audioRecorder.on('maxDurationReached', () => {
                this._showError('录音时间已达到上限（60秒）');
                this._stopRecording();
            });
        }

        /**
         * 尝试自动连接
         */
        async _tryAutoConnect() {
            if (!this.wsClient) return;

            try {
                const params = this._getConnectionParams();
                await this.wsClient.connect(params);
            } catch (error) {
                console.warn('ASRApp: Auto-connect failed:', error);
                this._updateStatus('disconnected', '未连接');
            }
        }

        /**
         * 获取连接参数
         */
        _getConnectionParams() {
            // 从UI获取识别模式，默认为offline
            const mode = this.elements.recognitionMode ? 
                        this.elements.recognitionMode.value : 'offline';
            
            return {
                mode: mode,
                wavName: 'h5_' + Date.now(),
                wavFormat: 'pcm',
                audioFs: 16000,
                itn: this.elements.useItn ? this.elements.useItn.checked : true,
                hotwords: this._parseHotwords(this.elements.hotwords ? this.elements.hotwords.value : ''),
                // HTTP头信息（通过连接参数发送，浏览器WebSocket不支持直接设置HTTP头）
                headers: {
                    'Tx-Code': 'your-tx-code',
                    'Access_Key_Id': 'your-access-key',
                    'Sec-Node-No': 'your-node-no',
                    'Trace-Id': 'trace-' + Date.now(),
                    'Content-Type': 'application/json'
                }
            };
        }

        /**
         * 解析热词配置
         */
        _parseHotwords(hotwordsText) {
            if (!hotwordsText || !hotwordsText.trim()) {
                return null;
            }

            const hotwords = {};
            const lines = hotwordsText.split(/[\r\n]+/);
            const regexNum = /^[0-9]+$/;

            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const weight = parts[parts.length - 1];
                    if (regexNum.test(weight)) {
                        const word = parts.slice(0, -1).join(' ');
                        if (word) {
                            hotwords[word] = parseInt(weight, 10);
                        }
                    }
                }
            }

            return Object.keys(hotwords).length > 0 ? JSON.stringify(hotwords) : null;
        }

        /**
         * 测试连接
         */
        async _testConnection() {
            if (!this.wsClient) return;

            this._showLoading('正在测试连接...');

            try {
                // 更新WebSocket配置
                this.wsClient.updateConfig({ url: this.elements.wsUrl.value });

                // 如果已连接，先断开
                if (this.wsClient.getState().connected) {
                    this.wsClient.disconnect();
                }

                // 尝试连接
                const params = this._getConnectionParams();
                await this.wsClient.connect(params);

                this._showSuccess('连接成功！');
            } catch (error) {
                if (this.errorHandler) {
                    this.errorHandler.handle(error, { context: 'testConnection' });
                }
            } finally {
                this._hideLoading();
            }
        }

        /**
         * 重置配置
         */
        _resetConfig() {
            if (this.elements.wsUrl) {
                this.elements.wsUrl.value = 'wss://192.168.1.17:10095/';
            }
            if (this.elements.recognitionMode) {
                this.elements.recognitionMode.value = 'offline';
            }
            if (this.elements.hotwords) {
                this.elements.hotwords.value = '';
            }
            if (this.elements.useItn) {
                this.elements.useItn.checked = true;
            }

            if (this.wsClient) {
                this.wsClient.updateConfig({ 
                    url: 'wss://192.168.1.17:10095/',
                    mode: 'offline'
                });
            }
        }

        /**
         * 处理录音开始
         */
        async _handleRecordStart(e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            // 如果正在录音，则停止录音（切换逻辑）
            if (this.isRecording) {
                await this._stopRecording();
                return;
            }

            // 检查 WebSocket 连接状态，如果断开则尝试重新连接
            if (!this.wsClient || !this.wsClient.getState().connected) {
                console.log('ASRApp: WebSocket not connected, attempting to reconnect...');
                this._showLoading('正在连接服务器...');
                try {
                    await this._tryAutoConnect();
                    // 等待连接建立
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    console.error('ASRApp: Failed to reconnect:', error);
                    this._hideLoading();
                    this._showError('连接服务器失败，请检查网络');
                    return;
                }
                this._hideLoading();
                
                // 再次检查连接状态
                if (!this.wsClient || !this.wsClient.getState().connected) {
                    this._showError('无法连接到服务器');
                    return;
                }
            }

            // 检查是否可以录音
            if (!this.stateManager || !this.stateManager.canPerform('startRecording')) {
                if (!this.stateManager || !this.stateManager.isConnected) {
                    this._showError('请先连接服务器');
                    return;
                }
            }

            try {
                // 清空之前的识别结果
                console.log('[ASR Debug] ========== 开始录音，清空所有识别数据 ==========');
                console.log('[ASR Debug] 清空前completedSentences数量:', this.completedSentences.length);
                console.log('[ASR Debug] 清空前currentSentence:', this.currentSentence);
                
                this.completedSentences = [];
                this.currentSentence = '';
                this.recognitionText = '';
                
                console.log('[ASR Debug] 已清空所有识别数据');
                console.log('[ASR Debug] ============================================');
                
                this._updateResultDisplay();

                // 开始录音
                if (this.audioRecorder) {
                    await this.audioRecorder.start();
                }

                this.isRecording = true;
                this.recordingStartTime = Date.now();

                // 切换UI
                this._switchToRecordingUI();

                console.log('ASRApp: Recording started');
            } catch (error) {
                this.isRecording = false;
                if (this.errorHandler) {
                    this.errorHandler.handle(error, { context: 'startRecording' });
                }
            }
        }

        /**
         * 处理录音结束
         */
        async _handleRecordEnd(e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            if (!this.isRecording) {
                return;
            }

            await this._stopRecording();
        }

        /**
         * 停止录音
         */
        async _stopRecording() {
            if (!this.isRecording) {
                return;
            }

            this.isRecording = false;

            try {
                // 停止录音
                if (this.audioRecorder) {
                    await this.audioRecorder.stop();
                }
            } catch (error) {
                console.error('ASRApp: Error stopping audio recorder:', error);
            }

            // 发送结束信号（如果 WebSocket 连接可用）
            try {
                if (this.wsClient && this.wsClient.getState().connected) {
                    const sent = this.wsClient.sendEndSignal();
                    if (!sent) {
                        console.warn('ASRApp: Failed to send end signal');
                    }
                } else {
                    console.warn('ASRApp: WebSocket not connected, skipping end signal');
                }
            } catch (error) {
                console.warn('ASRApp: Error sending end signal:', error);
            }

            // 切换UI
            this._switchToIdleUI();

            console.log('ASRApp: Recording stopped');
        }

        /**
         * 切换到录音UI
         */
        _switchToRecordingUI() {
            if (this.elements.recordIdle) {
                this.elements.recordIdle.style.display = 'none';
            }
            if (this.elements.recordActive) {
                this.elements.recordActive.style.display = 'flex';
            }
            if (this.elements.recordBtn) {
                this.elements.recordBtn.classList.add('recording');
            }

            // 启动录音时长计时
            this._startDurationTimer();
        }

        /**
         * 切换到空闲UI
         */
        _switchToIdleUI() {
            if (this.elements.recordIdle) {
                this.elements.recordIdle.style.display = 'flex';
            }
            if (this.elements.recordActive) {
                this.elements.recordActive.style.display = 'none';
            }
            if (this.elements.recordBtn) {
                this.elements.recordBtn.classList.remove('recording');
            }

            // 停止录音时长计时
            this._stopDurationTimer();

            // 重置时间显示
            if (this.elements.recordingTime) {
                this.elements.recordingTime.textContent = '00:00';
            }
        }

        /**
         * 启动录音时长计时器
         */
        _startDurationTimer() {
            this._updateRecordingTime(0);
        }

        /**
         * 停止录音时长计时器
         */
        _stopDurationTimer() {
            if (this.durationTimer) {
                clearInterval(this.durationTimer);
                this.durationTimer = null;
            }
        }

        /**
         * 更新录音时间显示
         */
        _updateRecordingTime(duration) {
            const seconds = Math.floor(duration / 1000);
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;

            const formattedTime = `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
            if (this.elements.recordingTime) {
                this.elements.recordingTime.textContent = formattedTime;
            }
        }

        /**
         * 处理识别结果（多句语音识别）
         * mode=='2pass-offline' 表示当前句子结束
         */
        _handleRecognitionResult(result) {
            const newText = result.text || '';
            const mode = result.mode || '';
            const isSentenceEnd = mode === '2pass-offline';
            
            console.log('[ASR Debug] ========== 识别结果回调 ==========');
            console.log('[ASR Debug] newText:', newText);
            console.log('[ASR Debug] mode:', mode);
            console.log('[ASR Debug] isSentenceEnd:', isSentenceEnd);
            console.log('[ASR Debug] 当前completedSentences数量:', this.completedSentences.length);
            console.log('[ASR Debug] 当前currentSentence:', this.currentSentence);
            
            if (!newText) {
                this._updateResultDisplay();
                return;
            }
            
            if (isSentenceEnd) {
                // 句子结束，保存到已完成列表
                this.completedSentences.push(newText);
                this.currentSentence = '';
                console.log('[ASR Debug] ✓✓✓ 句子结束！已保存到completedSentences');
                console.log('[ASR Debug]   已保存的句子:', newText);
                console.log('[ASR Debug]   completedSentences长度:', this.completedSentences.length);
            } else {
                // 中间结果，更新当前句子
                this.currentSentence += newText;
                console.log('[ASR Debug] ✓ 更新currentSentence:', newText);
            }
            
            // 更新完整展示文本
            // this._updateFullText();
            this.recognitionText = this.completedSentences.join('') + this.currentSentence;
            this._updateResultDisplay();
        }

        /**
         * 更新完整展示文本（已完成句子 + 当前句子）
         */
        // _updateFullText() {
        //     // 使用空格连接已完成的句子，让多句之间有空格分隔
        //     const completedPart = this.completedSentences.join(' ');
        //     // 如果有已完成的句子，且当前有正在识别的句子，中间加空格
        //     this.recognitionText = completedPart + this.currentSentence;
            
        //     console.log('[ASR Debug] ========== 更新完整文本 ==========');
        //     console.log('[ASR Debug] completedSentences数组:', JSON.stringify(this.completedSentences));
        //     console.log('[ASR Debug] completedPart:', completedPart);
        //     console.log('[ASR Debug] separator:', JSON.stringify(separator));
        //     console.log('[ASR Debug] currentSentence:', this.currentSentence);
        //     console.log('[ASR Debug] >>> 最终recognitionText:', this.recognitionText);
        //     console.log('[ASR Debug] 文本长度:', this.recognitionText.length);
        //     console.log('[ASR Debug] ====================================');
        // }

        /**
         * 处理识别完成（最终结束）
         * 保存最后一句（如果有）
         */
        _handleRecognitionComplete(result) {
            const finalText = result.text || '';
            
            console.log('[ASR Debug] ========== 识别完成回调 ==========');
            console.log('[ASR Debug] finalText:', finalText);
            console.log('[ASR Debug] 完成前completedSentences数量:', this.completedSentences.length);
            console.log('[ASR Debug] 完成前currentSentence:', this.currentSentence);
            
            // // 如果还有未保存的当前句子，保存它
            // if (this.currentSentence && this.currentSentence.trim()) {
            //     this.completedSentences.push(this.currentSentence);
            //     this.currentSentence = '';
            //     console.log('[ASR Debug] ✓ 保存最后一句到completedSentences');
            // }
            
            // // 使用最终结果更新（如果服务器返回了不同的结果）
            // if (finalText && finalText.trim()) {
            //     // 替换最后一句或添加为新句子
            //     if (this.completedSentences.length > 0) {
            //         this.completedSentences[this.completedSentences.length - 1] = finalText;
            //     } else {
            //         this.completedSentences.push(finalText);
            //     }
            //     console.log('[ASR Debug] ✓ 使用服务器最终结果更新');
            // }
            
            // // 更新完整文本
            // this._updateFullText();
            
            // console.log('[ASR Debug] 完成后completedSentences数量:', this.completedSentences.length);
            // console.log('[ASR Debug] 最终展示文本:', this.recognitionText);
            // console.log('[ASR Debug] ======================================');
            
            this.recognitionText = finalText;
            this._updateResultDisplay();

            // 显示元信息
            const meta = `识别模式: ${result.mode || 'offline'} | 耗时: ${Date.now() - (result.receiveTime || Date.now())}ms`;
            if (this.elements.resultMeta) {
                this.elements.resultMeta.textContent = meta;
            }

            console.log('ASRApp: Recognition complete:', result);
        }

        /**
         * 更新结果显示
         */
        _updateResultDisplay() {
            console.log('[ASR Debug] >>> _updateResultDisplay 被调用');
            console.log('[ASR Debug] resultContent元素存在:', !!this.elements.resultContent);
            console.log('[ASR Debug] completedSentences数量:', this.completedSentences.length);
            console.log('[ASR Debug] currentSentence:', this.currentSentence);
            console.log('[ASR Debug] 完整recognitionText:', this.recognitionText);
            
            if (!this.elements.resultContent) {
                console.log('[ASR Debug] ✗ resultContent元素不存在，退出更新');
                return;
            }

            if (this.recognitionText) {
                const html = `<div class="result-text">${this.escapeHtml(this.recognitionText)}</div>`;
                this.elements.resultContent.innerHTML = html;
                console.log('[ASR Debug] ✓ 已更新显示内容');
            } else {
                this.elements.resultContent.innerHTML = '<div class="result-placeholder">识别内容将显示在这里...</div>';
                console.log('[ASR Debug] ✓ 已显示占位符');
            }
            
            console.log('[ASR Debug] <<< _updateResultDisplay 完成');
        }

        /**
         * 清空结果
         */
        _clearResults() {
            this.completedSentences = [];
            this.currentSentence = '';
            this.recognitionText = '';
            this._updateResultDisplay();
            if (this.elements.resultMeta) {
                this.elements.resultMeta.textContent = '';
            }

            if (this.wsClient) {
                this.wsClient.clearResults();
            }
        }

        /**
         * 更新连接状态UI
         */
        _updateConnectionUI(state) {
            if (!this.elements.statusIndicator || !this.elements.statusText) return;

            const indicator = this.elements.statusIndicator;
            const statusText = this.elements.statusText;

            indicator.className = 'status-indicator';

            switch (state) {
                case ConnectionState.CONNECTED:
                    indicator.classList.add('connected');
                    statusText.textContent = '已连接';
                    break;
                case ConnectionState.CONNECTING:
                    indicator.classList.add('connecting');
                    statusText.textContent = '连接中...';
                    break;
                case ConnectionState.ERROR:
                    indicator.classList.add('error');
                    statusText.textContent = '连接错误';
                    break;
                default:
                    statusText.textContent = '未连接';
            }
        }

        /**
         * 更新录音状态UI
         */
        _updateRecordingUI(state) {
            if (!this.elements.statusIndicator) return;

            const indicator = this.elements.statusIndicator;

            if (state === RecordingState.RECORDING) {
                indicator.classList.add('recording');
            } else {
                indicator.classList.remove('recording');
            }
        }

        /**
         * 更新应用状态UI
         */
        _updateAppUI(state) {
            if (!this.elements.recordBtn) return;

            switch (state) {
                case AppState.READY:
                    this.elements.recordBtn.disabled = false;
                    break;
                case AppState.PROCESSING:
                    // 录音中，按钮状态由录音逻辑控制
                    break;
                case AppState.ERROR:
                    this.elements.recordBtn.disabled = true;
                    break;
            }
        }

        /**
         * 更新状态栏
         */
        _updateStatus(type, message) {
            if (this.elements.statusText) {
                this.elements.statusText.textContent = message;
            }
        }

        /**
         * 显示加载遮罩
         */
        _showLoading(text = '加载中...') {
            if (!this.elements.loadingMask) return;

            const loadingText = this.elements.loadingMask.querySelector('.loading-text');
            if (loadingText) {
                loadingText.textContent = text;
            }
            this.elements.loadingMask.style.display = 'flex';
        }

        /**
         * 隐藏加载遮罩
         */
        _hideLoading() {
            if (this.elements.loadingMask) {
                this.elements.loadingMask.style.display = 'none';
            }
        }

        /**
         * 显示错误提示
         */
        _showError(message) {
            if (this.errorHandler) {
                this.errorHandler.showErrorToast({
                    type: 'error',
                    message: message
                });
            } else {
                alert(message);
            }
        }

        /**
         * 显示成功提示
         */
        _showSuccess(message) {
            if (this.errorHandler) {
                this.errorHandler.showErrorToast({
                    type: 'success',
                    message: message
                });
            } else {
                alert(message);
            }
        }

        /**
         * 显示Toast提示（自动消失）
         */
        _showToast(message, duration = 2000) {
            // 创建toast元素
            let toast = document.getElementById('toast-message');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'toast-message';
                toast.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: rgba(0, 0, 0, 0.8);
                    color: white;
                    padding: 12px 24px;
                    border-radius: 8px;
                    font-size: 14px;
                    z-index: 9999;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity 0.3s;
                `;
                document.body.appendChild(toast);
            }
            
            toast.textContent = message;
            toast.style.opacity = '1';
            
            // 清除之前的定时器
            if (this._toastTimer) {
                clearTimeout(this._toastTimer);
            }
            
            // 自动隐藏
            this._toastTimer = setTimeout(() => {
                toast.style.opacity = '0';
            }, duration);
        }

        /**
         * HTML转义
         */
        escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        /**
         * 销毁应用
         */
        destroy() {
            console.log('ASRApp: Destroying...');

            // 移除事件监听
            if (typeof document.hidden !== 'undefined') {
                document.removeEventListener('visibilitychange', this._handleVisibilityChange);
            }
            window.removeEventListener('online', this._handleOnline);
            window.removeEventListener('offline', this._handleOffline);
            window.removeEventListener('beforeunload', this._handleBeforeUnload);

            // 停止录音
            if (this.isRecording) {
                this._stopRecording();
            }

            // 清除定时器
            this._stopDurationTimer();

            // 销毁模块
            if (this.audioRecorder) {
                this.audioRecorder.destroy();
                this.audioRecorder = null;
            }

            if (this.wsClient) {
                this.wsClient.destroy();
                this.wsClient = null;
            }

            if (this.stateManager) {
                this.stateManager.destroy();
                this.stateManager = null;
            }

            if (this.errorHandler) {
                this.errorHandler.destroy();
                this.errorHandler = null;
            }

            this._initialized = false;
            console.log('ASRApp: Destroyed');
        }
    }

    // 导出到全局
    window.ASRApp = ASRApp;

    // 页面加载完成后初始化应用
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.asrApp = new ASRApp();
            window.asrApp.init();
        });
    } else {
        // DOM已经加载完成
        window.asrApp = new ASRApp();
        window.asrApp.init();
    }

})(window);
