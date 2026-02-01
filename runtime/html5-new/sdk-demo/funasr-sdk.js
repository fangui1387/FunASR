/**
 * FunASR Web SDK - 合并版
 * 包含: stateManager.js, errorHandler.js, wsClient.js, audioRecorder.js, app.js
 * @version 1.0.0
 * @author FunASR Team
 */

// ==================== stateManager.js ====================

/**
 * 状态管理模块
 * 负责管理应用的各种状态，包括录音状态、连接状态等
 */

(function(window) {
    'use strict';

    // 状态枚举
    const ConnectionState = {
        DISCONNECTED: 'disconnected',
        CONNECTING: 'connecting',
        CONNECTED: 'connected',
        ERROR: 'error'
    };

    const RecordingState = {
        IDLE: 'idle',
        PREPARING: 'preparing',
        RECORDING: 'recording',
        STOPPING: 'stopping'
    };

    const AppState = {
        INITIALIZING: 'initializing',
        READY: 'ready',
        PROCESSING: 'processing',
        ERROR: 'error'
    };

    /**
     * 状态管理器类
     */
    class StateManager {
        constructor(options = {}) {
            // 参数验证
            if (options !== null && typeof options !== 'object') {
                throw new TypeError('StateManager: options must be an object');
            }

            // 当前状态
            this._connectionState = ConnectionState.DISCONNECTED;
            this._recordingState = RecordingState.IDLE;
            this._appState = AppState.INITIALIZING;
            
            // 状态变更回调
            this._listeners = new Map();
            
            // 状态历史（用于调试和恢复）
            this._stateHistory = [];
            this._maxHistorySize = 50;
            
            // 防抖配置
            this._debounceConfig = {
                enabled: options.debounce !== false, // 默认启用
                delay: options.debounceDelay || 50,  // 默认50ms
                maxWait: options.debounceMaxWait || 200 // 最大等待时间
            };

            // 验证防抖配置
            this._validateDebounceConfig();
            
            // 防抖定时器
            this._debounceTimers = new Map();
            this._debouncePending = new Map();

            // 销毁标志
            this._isDestroyed = false;
            
            // 初始化
            this._init();
        }

        /**
         * 验证防抖配置
         * @private
         */
        _validateDebounceConfig() {
            if (typeof this._debounceConfig.delay !== 'number' || this._debounceConfig.delay < 0) {
                console.warn('StateManager: Invalid debounceDelay, using default 50');
                this._debounceConfig.delay = 50;
            }

            if (typeof this._debounceConfig.maxWait !== 'number' || this._debounceConfig.maxWait < 0) {
                console.warn('StateManager: Invalid debounceMaxWait, using default 200');
                this._debounceConfig.maxWait = 200;
            }
        }

        /**
         * 检查实例是否已被销毁
         * @private
         */
        _checkDestroyed() {
            if (this._isDestroyed) {
                throw new Error('StateManager: Instance has been destroyed');
            }
        }

        /**
         * 初始化状态管理器
         */
        _init() {
            // 注册内置状态变更监听
            this.on('connectionChange', this._onConnectionChange.bind(this));
            this.on('recordingChange', this._onRecordingChange.bind(this));
            this.on('appStateChange', this._onAppStateChange.bind(this));
            
            // 记录初始状态
            this._logStateChange('init', {
                connection: this._connectionState,
                recording: this._recordingState,
                app: this._appState
            });
        }

        /**
         * 记录状态变更历史
         */
        _logStateChange(type, states) {
            const entry = {
                timestamp: Date.now(),
                type: type,
                states: states
            };
            
            this._stateHistory.push(entry);
            
            // 限制历史记录大小
            if (this._stateHistory.length > this._maxHistorySize) {
                this._stateHistory.shift();
            }
        }

        /**
         * 触发事件（带防抖）
         */
        _emit(eventName, data) {
            // 如果防抖未启用，直接触发
            if (!this._debounceConfig.enabled) {
                this._doEmit(eventName, data);
                return;
            }
            
            // 清除之前的定时器
            if (this._debounceTimers.has(eventName)) {
                clearTimeout(this._debounceTimers.get(eventName));
            }
            
            // 保存待触发的数据
            this._debouncePending.set(eventName, data);
            
            // 检查是否需要立即触发（超过最大等待时间）
            const pendingTime = this._debouncePending.get(`${eventName}_time`);
            const now = Date.now();
            
            if (!pendingTime) {
                this._debouncePending.set(`${eventName}_time`, now);
            } else if (now - pendingTime > this._debounceConfig.maxWait) {
                // 超过最大等待时间，立即触发
                this._flushDebounce(eventName);
                return;
            }
            
            // 设置新的定时器
            const timer = setTimeout(() => {
                this._flushDebounce(eventName);
            }, this._debounceConfig.delay);
            
            this._debounceTimers.set(eventName, timer);
        }
        
        /**
         * 立即执行防抖队列中的事件
         */
        _flushDebounce(eventName) {
            const data = this._debouncePending.get(eventName);
            if (data) {
                this._doEmit(eventName, data);
                this._debouncePending.delete(eventName);
                this._debouncePending.delete(`${eventName}_time`);
            }
            
            if (this._debounceTimers.has(eventName)) {
                clearTimeout(this._debounceTimers.get(eventName));
                this._debounceTimers.delete(eventName);
            }
        }
        
        /**
         * 立即触发事件（内部方法）
         */
        _doEmit(eventName, data) {
            const listeners = this._listeners.get(eventName);
            if (listeners) {
                listeners.forEach(callback => {
                    try {
                        callback(data);
                    } catch (error) {
                        console.error(`StateManager: Error in listener for ${eventName}:`, error);
                    }
                });
            }
        }

        /**
         * 注册状态变更监听
         */
        on(eventName, callback) {
            if (!this._listeners.has(eventName)) {
                this._listeners.set(eventName, new Set());
            }
            this._listeners.get(eventName).add(callback);
            
            // 返回取消订阅函数
            return () => {
                this._listeners.get(eventName).delete(callback);
            };
        }

        /**
         * 连接状态变更处理
         */
        _onConnectionChange({ state, prevState }) {
            console.log(`StateManager: Connection state changed from ${prevState} to ${state}`);
            
            // 根据连接状态更新应用状态
            switch (state) {
                case ConnectionState.CONNECTED:
                    if (this._appState === AppState.INITIALIZING) {
                        this.setAppState(AppState.READY);
                    }
                    break;
                case ConnectionState.ERROR:
                    this.setAppState(AppState.ERROR);
                    break;
                case ConnectionState.DISCONNECTED:
                    if (this._recordingState === RecordingState.RECORDING) {
                        this.setRecordingState(RecordingState.IDLE);
                    }
                    break;
            }
        }

        /**
         * 录音状态变更处理
         */
        _onRecordingChange({ state, prevState }) {
            console.log(`StateManager: Recording state changed from ${prevState} to ${state}`);
            
            // 根据录音状态更新应用状态
            switch (state) {
                case RecordingState.RECORDING:
                    this.setAppState(AppState.PROCESSING);
                    break;
                case RecordingState.IDLE:
                    if (this._connectionState === ConnectionState.CONNECTED) {
                        this.setAppState(AppState.READY);
                    }
                    break;
            }
        }

        /**
         * 应用状态变更处理
         */
        _onAppStateChange({ state, prevState }) {
            console.log(`StateManager: App state changed from ${prevState} to ${state}`);
        }

        // ==================== 连接状态管理 ====================

        /**
         * 获取当前连接状态
         */
        get connectionState() {
            return this._connectionState;
        }

        /**
         * 设置连接状态
         * @param {string} state - 连接状态
         * @returns {boolean} 设置是否成功
         */
        setConnectionState(state) {
            this._checkDestroyed();

            try {
                if (!Object.values(ConnectionState).includes(state)) {
                    console.error(`StateManager: Invalid connection state: ${state}`);
                    return false;
                }
                
                if (this._connectionState === state) {
                    return false;
                }
                
                const prevState = this._connectionState;
                this._connectionState = state;
                
                this._logStateChange('connectionChange', {
                    from: prevState,
                    to: state
                });
                
                this._emit('connectionChange', { state, prevState });
                this._emit('stateChange', {
                    type: 'connection',
                    state,
                    prevState
                });
                
                return true;
            } catch (error) {
                console.error('StateManager: Error setting connection state:', error);
                return false;
            }
        }

        /**
         * 是否已连接
         */
        get isConnected() {
            return this._connectionState === ConnectionState.CONNECTED;
        }

        /**
         * 是否正在连接
         */
        get isConnecting() {
            return this._connectionState === ConnectionState.CONNECTING;
        }

        // ==================== 录音状态管理 ====================

        /**
         * 获取当前录音状态
         */
        get recordingState() {
            return this._recordingState;
        }

        /**
         * 设置录音状态
         * @param {string} state - 录音状态
         * @returns {boolean} 设置是否成功
         */
        setRecordingState(state) {
            this._checkDestroyed();

            try {
                if (!Object.values(RecordingState).includes(state)) {
                    console.error(`StateManager: Invalid recording state: ${state}`);
                    return false;
                }
                
                if (this._recordingState === state) {
                    return false;
                }
                
                const prevState = this._recordingState;
                this._recordingState = state;
                
                this._logStateChange('recordingChange', {
                    from: prevState,
                    to: state
                });
                
                this._emit('recordingChange', { state, prevState });
                this._emit('stateChange', {
                    type: 'recording',
                    state,
                    prevState
                });
                
                return true;
            } catch (error) {
                console.error('StateManager: Error setting recording state:', error);
                return false;
            }
        }

        /**
         * 是否正在录音
         */
        get isRecording() {
            return this._recordingState === RecordingState.RECORDING;
        }

        /**
         * 是否可以开始录音
         */
        get canStartRecording() {
            return this._recordingState === RecordingState.IDLE && 
                   this._connectionState === ConnectionState.CONNECTED;
        }

        // ==================== 应用状态管理 ====================

        /**
         * 获取当前应用状态
         */
        get appState() {
            return this._appState;
        }

        /**
         * 设置应用状态
         * @param {string} state - 应用状态
         * @returns {boolean} 设置是否成功
         */
        setAppState(state) {
            this._checkDestroyed();

            try {
                if (!Object.values(AppState).includes(state)) {
                    console.error(`StateManager: Invalid app state: ${state}`);
                    return false;
                }
                
                if (this._appState === state) {
                    return false;
                }
                
                const prevState = this._appState;
                this._appState = state;
                
                this._logStateChange('appStateChange', {
                    from: prevState,
                    to: state
                });
                
                this._emit('appStateChange', { state, prevState });
                this._emit('stateChange', {
                    type: 'app',
                    state,
                    prevState
                });
                
                return true;
            } catch (error) {
                console.error('StateManager: Error setting app state:', error);
                return false;
            }
        }

        /**
         * 应用是否就绪
         */
        get isReady() {
            return this._appState === AppState.READY;
        }

        // ==================== 状态查询方法 ====================

        /**
         * 获取完整状态快照
         */
        getSnapshot() {
            return {
                connection: this._connectionState,
                recording: this._recordingState,
                app: this._appState,
                timestamp: Date.now()
            };
        }

        /**
         * 获取状态历史
         */
        getHistory() {
            return [...this._stateHistory];
        }

        /**
         * 清空状态历史
         */
        clearHistory() {
            this._stateHistory = [];
        }

        /**
         * 检查是否可以执行某个操作
         */
        canPerform(action) {
            const actionMap = {
                'connect': () => this._connectionState === ConnectionState.DISCONNECTED,
                'disconnect': () => this._connectionState === ConnectionState.CONNECTED,
                'startRecording': () => this.canStartRecording,
                'stopRecording': () => this._recordingState === RecordingState.RECORDING,
                'configure': () => this._recordingState === RecordingState.IDLE
            };
            
            const checker = actionMap[action];
            return checker ? checker() : false;
        }

        /**
         * 重置所有状态
         */
        reset() {
            const prevStates = this.getSnapshot();
            
            this._connectionState = ConnectionState.DISCONNECTED;
            this._recordingState = RecordingState.IDLE;
            this._appState = AppState.INITIALIZING;
            
            this._logStateChange('reset', {
                from: prevStates,
                to: this.getSnapshot()
            });
            
            this._emit('stateReset', { prevStates });
        }

        /**
         * 销毁状态管理器
         */
        destroy() {
            if (this._isDestroyed) {
                return;
            }

            this._isDestroyed = true;

            try {
                // 清除所有防抖定时器
                this._debounceTimers.forEach(timer => {
                    try {
                        clearTimeout(timer);
                    } catch (e) {
                        // 忽略清除错误
                    }
                });
                this._debounceTimers.clear();
                this._debouncePending.clear();
                
                this._listeners.clear();
                this._stateHistory = [];
            } catch (error) {
                console.error('StateManager: Error during destroy:', error);
            }
        }

        /**
         * 手动刷新所有防抖中的事件
         */
        flush() {
            this._debounceTimers.forEach((timer, eventName) => {
                this._flushDebounce(eventName);
            });
        }

        /**
         * 更新防抖配置
         */
        updateDebounceConfig(config) {
            this._debounceConfig = {
                ...this._debounceConfig,
                ...config
            };
        }
    }

    // 导出到全局
    window.StateManager = StateManager;
    window.ConnectionState = ConnectionState;
    window.RecordingState = RecordingState;
    window.AppState = AppState;

})(window);


// ==================== errorHandler.js ====================

/**
 * 错误处理模块
 * 负责统一处理应用中的各种错误，提供友好的错误提示和恢复机制
 */

(function(window) {
    'use strict';

    // 错误类型枚举
    const ErrorType = {
        // 网络相关错误
        NETWORK_ERROR: 'network_error',
        WEBSOCKET_ERROR: 'websocket_error',
        CONNECTION_TIMEOUT: 'connection_timeout',
        CONNECTION_REFUSED: 'connection_refused',
        
        // 权限相关错误
        PERMISSION_DENIED: 'permission_denied',
        PERMISSION_PROMPT: 'permission_prompt',
        
        // 设备相关错误
        DEVICE_NOT_SUPPORTED: 'device_not_supported',
        MICROPHONE_NOT_FOUND: 'microphone_not_found',
        MICROPHONE_IN_USE: 'microphone_in_use',
        
        // 录音相关错误
        RECORDING_ERROR: 'recording_error',
        RECORDING_TIMEOUT: 'recording_timeout',
        AUDIO_PROCESSING_ERROR: 'audio_processing_error',
        
        // 配置相关错误
        CONFIG_ERROR: 'config_error',
        INVALID_URL: 'invalid_url',
        INVALID_PARAMS: 'invalid_params',
        
        // 浏览器相关错误
        BROWSER_NOT_SUPPORTED: 'browser_not_supported',
        HTTPS_REQUIRED: 'https_required',
        
        // 未知错误
        UNKNOWN_ERROR: 'unknown_error'
    };

    // 错误代码映射
    const ErrorCodeMap = {
        // WebSocket错误代码
        1000: { type: ErrorType.WEBSOCKET_ERROR, message: '连接正常关闭' },
        1001: { type: ErrorType.WEBSOCKET_ERROR, message: '终端离开' },
        1002: { type: ErrorType.WEBSOCKET_ERROR, message: '协议错误' },
        1003: { type: ErrorType.WEBSOCKET_ERROR, message: '数据类型错误' },
        1005: { type: ErrorType.WEBSOCKET_ERROR, message: '连接关闭' },
        1006: { type: ErrorType.WEBSOCKET_ERROR, message: '连接异常关闭' },
        1007: { type: ErrorType.WEBSOCKET_ERROR, message: '数据格式错误' },
        1008: { type: ErrorType.WEBSOCKET_ERROR, message: '策略违规' },
        1009: { type: ErrorType.WEBSOCKET_ERROR, message: '消息过大' },
        1010: { type: ErrorType.WEBSOCKET_ERROR, message: '扩展协商失败' },
        1011: { type: ErrorType.WEBSOCKET_ERROR, message: '服务器错误' },
        1015: { type: ErrorType.WEBSOCKET_ERROR, message: 'TLS握手失败' },
        
        // getUserMedia错误
        'NotAllowedError': { type: ErrorType.PERMISSION_DENIED, message: '用户拒绝了麦克风权限' },
        'NotFoundError': { type: ErrorType.MICROPHONE_NOT_FOUND, message: '未找到麦克风设备' },
        'NotReadableError': { type: ErrorType.MICROPHONE_IN_USE, message: '麦克风被其他应用占用' },
        'OverconstrainedError': { type: ErrorType.DEVICE_NOT_SUPPORTED, message: '设备不支持指定的约束条件' },
        'SecurityError': { type: ErrorType.HTTPS_REQUIRED, message: '需要在安全环境(HTTPS)下使用' },
        'AbortError': { type: ErrorType.RECORDING_ERROR, message: '录音被中断' }
    };

    // 错误恢复策略
    const RecoveryStrategies = {
        [ErrorType.NETWORK_ERROR]: {
            retryable: true,
            maxRetries: 3,
            retryDelay: 2000,
            fallback: 'offline_mode'
        },
        [ErrorType.WEBSOCKET_ERROR]: {
            retryable: true,
            maxRetries: 3,
            retryDelay: 3000,
            fallback: 'reconnect'
        },
        [ErrorType.CONNECTION_TIMEOUT]: {
            retryable: true,
            maxRetries: 2,
            retryDelay: 5000,
            fallback: 'check_network'
        },
        [ErrorType.PERMISSION_DENIED]: {
            retryable: false,
            action: 'show_settings_guide'
        },
        [ErrorType.MICROPHONE_NOT_FOUND]: {
            retryable: false,
            action: 'check_device'
        },
        [ErrorType.BROWSER_NOT_SUPPORTED]: {
            retryable: false,
            action: 'upgrade_browser'
        },
        [ErrorType.HTTPS_REQUIRED]: {
            retryable: false,
            action: 'use_https'
        },
        [ErrorType.RECORDING_ERROR]: {
            retryable: true,
            maxRetries: 2,
            retryDelay: 1000,
            fallback: 'restart_recording'
        }
    };

    /**
     * 错误处理器类
     */
    class ErrorHandler {
        constructor(options = {}) {
            // 参数验证
            if (options !== null && typeof options !== 'object') {
                throw new TypeError('ErrorHandler: options must be an object');
            }

            this.options = {
                showToast: true,
                logErrors: true,
                autoRecovery: true,
                maxRetries: 3,
                deduplicationWindow: 5000, // 错误去重时间窗口(ms)
                ...(options || {})
            };

            // 验证选项
            this._validateOptions();
            
            // 重试计数器
            this._retryCounts = new Map();
            
            // 错误监听器
            this._listeners = new Map();
            
            // 错误历史
            this._errorHistory = [];
            this._maxHistorySize = 100;
            
            // 错误去重缓存
            this._errorCache = new Map();
            
            // 错误上下文信息
            this._contextInfo = this._collectContext();

            // 销毁标志
            this._isDestroyed = false;

            // 恢复策略执行状态
            this._recoveryInProgress = new Set();
        }

        /**
         * 验证选项参数
         * @private
         */
        _validateOptions() {
            if (typeof this.options.maxRetries !== 'number' || this.options.maxRetries < 0) {
                console.warn('ErrorHandler: Invalid maxRetries, using default 3');
                this.options.maxRetries = 3;
            }

            if (typeof this.options.deduplicationWindow !== 'number' || this.options.deduplicationWindow < 0) {
                console.warn('ErrorHandler: Invalid deduplicationWindow, using default 5000');
                this.options.deduplicationWindow = 5000;
            }
        }

        /**
         * 检查实例是否已被销毁
         * @private
         */
        _checkDestroyed() {
            if (this._isDestroyed) {
                throw new Error('ErrorHandler: Instance has been destroyed');
            }
        }

        /**
         * 注册错误监听
         */
        on(errorType, callback) {
            if (!this._listeners.has(errorType)) {
                this._listeners.set(errorType, new Set());
            }
            this._listeners.get(errorType).add(callback);
            
            return () => {
                this._listeners.get(errorType).delete(callback);
            };
        }

        /**
         * 触发错误监听
         */
        _emit(errorType, error) {
            const listeners = this._listeners.get(errorType);
            if (listeners) {
                listeners.forEach(callback => {
                    try {
                        callback(error);
                    } catch (e) {
                        console.error('ErrorHandler: Error in listener:', e);
                    }
                });
            }
            
            // 触发通用监听
            const globalListeners = this._listeners.get('*');
            if (globalListeners) {
                globalListeners.forEach(callback => {
                    try {
                        callback(error);
                    } catch (e) {
                        console.error('ErrorHandler: Error in global listener:', e);
                    }
                });
            }
        }

        /**
         * 收集错误上下文信息
         * @returns {Object} 上下文信息
         */
        _collectContext() {
            try {
                // 检查浏览器环境
                if (typeof window === 'undefined' || typeof navigator === 'undefined') {
                    return {
                        environment: 'non-browser',
                        timestamp: new Date().toISOString()
                    };
                }

                return {
                    url: window.location?.href || 'unknown',
                    userAgent: navigator.userAgent || 'unknown',
                    viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
                    screenResolution: window.screen ? `${window.screen.width}x${window.screen.height}` : 'unknown',
                    online: navigator.onLine,
                    language: navigator.language || 'unknown',
                    platform: navigator.platform || 'unknown',
                    cores: navigator.hardwareConcurrency || 'unknown',
                    memory: (typeof performance !== 'undefined' && performance.memory) ? {
                        usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB',
                        totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1048576) + 'MB'
                    } : null,
                    connection: (navigator.connection) ? {
                        effectiveType: navigator.connection.effectiveType,
                        downlink: navigator.connection.downlink,
                        rtt: navigator.connection.rtt
                    } : null,
                    timestamp: new Date().toISOString()
                };
            } catch (error) {
                console.error('ErrorHandler: Error collecting context:', error);
                return {
                    error: 'Failed to collect context',
                    timestamp: new Date().toISOString()
                };
            }
        }

        /**
         * 检查是否是重复错误
         */
        _isDuplicateError(error) {
            const key = `${error.type}-${error.message}`;
            const lastTime = this._errorCache.get(key);
            const now = Date.now();
            const window = this.options.deduplicationWindow;
            
            if (lastTime && (now - lastTime) < window) {
                console.log(`ErrorHandler: Duplicate error suppressed: ${key}`);
                return true;
            }
            
            this._errorCache.set(key, now);
            
            // 清理过期的缓存项
            this._cleanupErrorCache();
            
            return false;
        }

        /**
         * 清理错误缓存
         */
        _cleanupErrorCache() {
            const now = Date.now();
            const window = this.options.deduplicationWindow;
            
            for (const [key, timestamp] of this._errorCache.entries()) {
                if ((now - timestamp) > window) {
                    this._errorCache.delete(key);
                }
            }
        }

        /**
         * 记录错误历史
         */
        _logError(error) {
            if (!this.options.logErrors) return;
            
            const entry = {
                timestamp: Date.now(),
                context: this._contextInfo,
                ...error
            };
            
            this._errorHistory.push(entry);
            
            if (this._errorHistory.length > this._maxHistorySize) {
                this._errorHistory.shift();
            }
            
            // 控制台输出
            console.error(`[ErrorHandler] ${error.type}:`, error.message, error.originalError);
            console.error(`[ErrorHandler] Context:`, this._contextInfo);
        }

        /**
         * 处理错误
         * @param {Error|string|Object} error - 错误对象
         * @param {Object} context - 错误上下文
         * @returns {Object} 标准化后的错误对象
         */
        handle(error, context = {}) {
            this._checkDestroyed();

            try {
                // 验证参数
                if (!error) {
                    console.warn('ErrorHandler: Received empty error');
                    return null;
                }

                const normalizedError = this._normalizeError(error, context);
                
                // 检查是否是重复错误
                if (this._isDuplicateError(normalizedError)) {
                    return normalizedError;
                }
                
                // 更新上下文信息（每次处理错误时刷新）
                this._contextInfo = this._collectContext();
                
                // 记录错误
                this._logError(normalizedError);
                
                // 触发监听
                this._emit(normalizedError.type, normalizedError);
                
                // 显示错误提示
                if (this.options.showToast) {
                    try {
                        this.showErrorToast(normalizedError);
                    } catch (toastError) {
                        console.error('ErrorHandler: Error showing toast:', toastError);
                    }
                }
                
                // 尝试自动恢复
                if (this.options.autoRecovery && normalizedError.recoverable) {
                    try {
                        this._attemptRecovery(normalizedError);
                    } catch (recoveryError) {
                        console.error('ErrorHandler: Error attempting recovery:', recoveryError);
                    }
                }
                
                return normalizedError;
            } catch (handleError) {
                console.error('ErrorHandler: Error handling error:', handleError);
                // 返回一个基本的错误对象
                return {
                    type: ErrorType.UNKNOWN_ERROR,
                    message: typeof error === 'string' ? error : 'Error handling failed',
                    originalError: error,
                    context: context,
                    timestamp: Date.now(),
                    recoverable: false
                };
            }
        }

        /**
         * 标准化错误信息
         */
        _normalizeError(error, context) {
            let normalized = {
                type: ErrorType.UNKNOWN_ERROR,
                code: null,
                message: '发生未知错误',
                originalError: error,
                context: context,
                timestamp: Date.now(),
                recoverable: false,
                retryCount: 0
            };

            // 处理不同类型的错误输入
            if (typeof error === 'string') {
                normalized.message = error;
            } else if (error instanceof Error) {
                normalized.message = error.message;
                normalized.code = error.code || error.name;
                
                // 尝试从错误代码映射中获取类型
                const mapped = ErrorCodeMap[normalized.code];
                if (mapped) {
                    normalized.type = mapped.type;
                    normalized.message = mapped.message;
                }
                
                // 特殊处理某些错误类型
                if (error.name === 'NotAllowedError') {
                    normalized.type = ErrorType.PERMISSION_DENIED;
                    normalized.message = '用户拒绝了麦克风权限，请在浏览器设置中允许访问麦克风';
                }
            } else if (error && typeof error === 'object') {
                Object.assign(normalized, error);
            }

            // 根据错误类型设置可恢复性
            const strategy = RecoveryStrategies[normalized.type];
            if (strategy) {
                normalized.recoverable = strategy.retryable;
                normalized.retryCount = this._retryCounts.get(normalized.type) || 0;
            }

            return normalized;
        }

        /**
         * 尝试自动恢复
         * @param {Object} error - 标准化错误对象
         * @returns {boolean} 是否成功启动恢复
         */
        _attemptRecovery(error) {
            try {
                // 检查是否已在恢复中
                if (this._recoveryInProgress.has(error.type)) {
                    console.log(`ErrorHandler: Recovery already in progress for ${error.type}`);
                    return false;
                }

                const strategy = RecoveryStrategies[error.type];
                if (!strategy || !strategy.retryable) {
                    return false;
                }

                const retryCount = this._retryCounts.get(error.type) || 0;
                
                if (retryCount >= (strategy.maxRetries || this.options.maxRetries)) {
                    console.log(`ErrorHandler: Max retries reached for ${error.type}`);
                    this._retryCounts.delete(error.type);
                    this._recoveryInProgress.delete(error.type);
                    return false;
                }

                this._retryCounts.set(error.type, retryCount + 1);
                this._recoveryInProgress.add(error.type);
                
                console.log(`ErrorHandler: Attempting recovery for ${error.type}, retry ${retryCount + 1}`);
                
                setTimeout(() => {
                    try {
                        this._emit('recovery', {
                            error: error,
                            retryCount: retryCount + 1,
                            strategy: strategy
                        });
                    } catch (emitError) {
                        console.error('ErrorHandler: Error emitting recovery event:', emitError);
                    } finally {
                        this._recoveryInProgress.delete(error.type);
                    }
                }, strategy.retryDelay || 2000);
                
                return true;
            } catch (recoveryError) {
                console.error('ErrorHandler: Error in _attemptRecovery:', recoveryError);
                this._recoveryInProgress.delete(error.type);
                return false;
            }
        }

        /**
         * 重置重试计数
         */
        resetRetryCount(errorType) {
            if (errorType) {
                this._retryCounts.delete(errorType);
            } else {
                this._retryCounts.clear();
            }
        }

        /**
         * 显示错误提示
         */
        showErrorToast(error) {
            // 获取错误提示元素
            const toast = document.getElementById('errorToast');
            const messageEl = document.getElementById('errorMessage');
            const closeBtn = document.getElementById('errorCloseBtn');
            
            if (!toast || !messageEl) {
                // 降级方案：使用 alert
                alert(error.message);
                return;
            }

            // 设置错误消息
            messageEl.textContent = error.message;
            
            // 显示提示
            toast.style.display = 'block';
            
            // 绑定关闭事件
            const closeHandler = () => {
                toast.style.display = 'none';
                closeBtn.removeEventListener('click', closeHandler);
            };
            
            closeBtn.addEventListener('click', closeHandler);
            
            // 自动关闭
            setTimeout(() => {
                if (toast.style.display !== 'none') {
                    closeHandler();
                }
            }, 5000);
        }

        /**
         * 获取用户友好的错误消息
         */
        getFriendlyMessage(errorType, customMessage) {
            const messages = {
                [ErrorType.NETWORK_ERROR]: '网络连接异常，请检查网络设置',
                [ErrorType.WEBSOCKET_ERROR]: 'WebSocket连接失败，请检查服务器地址',
                [ErrorType.CONNECTION_TIMEOUT]: '连接超时，请稍后重试',
                [ErrorType.CONNECTION_REFUSED]: '连接被拒绝，请检查服务器是否运行',
                [ErrorType.PERMISSION_DENIED]: '需要麦克风权限才能录音',
                [ErrorType.PERMISSION_PROMPT]: '请在弹出的权限请求中允许访问麦克风',
                [ErrorType.DEVICE_NOT_SUPPORTED]: '当前设备不支持录音功能',
                [ErrorType.MICROPHONE_NOT_FOUND]: '未检测到麦克风设备',
                [ErrorType.MICROPHONE_IN_USE]: '麦克风正被其他应用使用',
                [ErrorType.RECORDING_ERROR]: '录音出现错误，请重试',
                [ErrorType.RECORDING_TIMEOUT]: '录音时间过长，请分段录制',
                [ErrorType.AUDIO_PROCESSING_ERROR]: '音频处理失败',
                [ErrorType.CONFIG_ERROR]: '配置错误，请检查设置',
                [ErrorType.INVALID_URL]: '服务器地址格式不正确',
                [ErrorType.INVALID_PARAMS]: '参数设置不正确',
                [ErrorType.BROWSER_NOT_SUPPORTED]: '当前浏览器不支持录音功能，请使用Chrome、Safari或Edge',
                [ErrorType.HTTPS_REQUIRED]: '录音功能需要在HTTPS环境下使用',
                [ErrorType.UNKNOWN_ERROR]: '发生未知错误，请刷新页面重试'
            };
            
            return customMessage || messages[errorType] || messages[ErrorType.UNKNOWN_ERROR];
        }

        /**
         * 获取错误历史
         */
        getHistory() {
            return [...this._errorHistory];
        }

        /**
         * 清空错误历史
         */
        clearHistory() {
            this._errorHistory = [];
        }

        /**
         * 检查是否在安全上下文中（宽松模式，允许更多环境）
         */
        _isSecureContext() {
            // 检查标准的 isSecureContext
            if (window.isSecureContext === true) {
                return true;
            }
            
            // 检查是否是localhost或127.0.0.1
            const hostname = window.location.hostname;
            const isLocalhost = hostname === 'localhost' || 
                               hostname === '127.0.0.1' || 
                               hostname === '[::1]' ||
                               hostname === '0.0.0.0' ||
                               hostname === '';  // 空hostname也视为本地
            
            if (isLocalhost) {
                return true;
            }
            
            // 检查是否是HTTPS
            const isHttps = window.location.protocol === 'https:';
            
            // 检查是否是file协议（本地文件）
            const isFile = window.location.protocol === 'file:';
            
            // 检查是否是HTTP（在移动端浏览器中允许，实际权限请求由浏览器控制）
            const isHttp = window.location.protocol === 'http:';
            
            return isHttps || isFile || isHttp;
        }

        /**
         * 检测是否是微信浏览器
         */
        _isWeChatBrowser() {
            const ua = navigator.userAgent.toLowerCase();
            return ua.indexOf('micromessenger') !== -1;
        }

        /**
         * 检测是否是iOS设备
         */
        _isiOS() {
            const ua = navigator.userAgent.toLowerCase();
            return /iphone|ipad|ipod/.test(ua);
        }

        /**
         * 检测是否是Android设备
         */
        _isAndroid() {
            const ua = navigator.userAgent.toLowerCase();
            return /android/.test(ua);
        }

        /**
         * 检查浏览器支持情况（宽松模式）
         */
        checkBrowserSupport() {
            // 检测getUserMedia支持（处理不同浏览器前缀）
            const getUserMedia = navigator.mediaDevices && navigator.mediaDevices.getUserMedia ||
                                navigator.getUserMedia ||
                                navigator.webkitGetUserMedia ||
                                navigator.mozGetUserMedia ||
                                navigator.msGetUserMedia;

            const checks = {
                websocket: 'WebSocket' in window,
                getUserMedia: !!getUserMedia,
                audioContext: !!(window.AudioContext || window.webkitAudioContext || window.mozAudioContext),
                secureContext: this._isSecureContext(),
                isWeChat: this._isWeChatBrowser(),
                isiOS: this._isiOS(),
                isAndroid: this._isAndroid()
            };

            const errors = [];
            const warnings = [];

            if (!checks.websocket) {
                errors.push({
                    type: ErrorType.BROWSER_NOT_SUPPORTED,
                    message: '当前浏览器不支持WebSocket'
                });
            }

            // 对getUserMedia的检测改为警告级别，允许尝试
            if (!checks.getUserMedia) {
                // 微信浏览器在iOS上可能需要特殊处理
                if (checks.isWeChat && checks.isiOS) {
                    warnings.push({
                        type: ErrorType.BROWSER_NOT_SUPPORTED,
                        message: '微信浏览器在iOS上可能需要iOS 14.3以上版本，将尝试启动录音功能'
                    });
                } else {
                    warnings.push({
                        type: ErrorType.BROWSER_NOT_SUPPORTED,
                        message: '当前浏览器可能不支持麦克风录音，将尝试启动录音功能'
                    });
                }
            }

            if (!checks.audioContext) {
                warnings.push({
                    type: ErrorType.BROWSER_NOT_SUPPORTED,
                    message: '当前浏览器可能不支持音频处理，将尝试启动录音功能'
                });
            }

            // 对安全环境的检测改为警告级别
            if (!checks.secureContext) {
                warnings.push({
                    type: ErrorType.HTTPS_REQUIRED,
                    message: '当前环境不是HTTPS，部分浏览器可能限制录音功能，将尝试启动录音功能'
                });
            }

            // 只要有WebSocket支持，就允许运行（宽松模式）
            const isSupported = checks.websocket;

            return {
                supported: isSupported,
                checks: checks,
                errors: errors,
                warnings: warnings,
                strictMode: false  // 标记为非严格模式
            };
        }

        /**
         * 销毁错误处理器
         */
        destroy() {
            if (this._isDestroyed) {
                return;
            }

            this._isDestroyed = true;

            try {
                this._listeners.clear();
                this._retryCounts.clear();
                this._errorHistory = [];
                this._errorCache.clear();
                this._recoveryInProgress.clear();
                this._contextInfo = null;
            } catch (error) {
                console.error('ErrorHandler: Error during destroy:', error);
            }
        }
    }

    // 导出到全局
    window.ErrorHandler = ErrorHandler;
    window.ErrorType = ErrorType;

})(window);


// ==================== wsClient.js ====================

/**
 * WebSocket通信层
 * 负责与FunASR服务器建立WebSocket连接，处理音频数据传输和识别结果接收
 * 严格遵循API.md接口文档规范
 * 
 * 健壮性特性：
 * - 发送超时机制
 * - 浏览器离线检测
 * - 资源清理
 */

(function(window) {
    'use strict';

    // WebSocket状态枚举
    const WSState = {
        CONNECTING: 0,
        OPEN: 1,
        CLOSING: 2,
        CLOSED: 3
    };

    // 默认配置
    const DEFAULT_CONFIG = {
        url: 'wss://127.0.0.1:10095/',
        mode: 'offline',
        wavName: 'h5_recording',
        wavFormat: 'pcm',
        audioFs: 16000,
        chunkSize: [5, 10, 5],
        chunkInterval: 10,
        itn: true,
        hotwords: null,
        reconnectAttempts: 3,
        reconnectDelay: 3000,
        connectionTimeout: 10000,
        heartbeatInterval: 30000,
        maxQueueSize: 100, // 最大发送队列大小
        sendTimeout: 5000, // 发送超时时间(ms)
        headers: {} // URL查询参数（WebSocket不支持HTTP请求头），请根据实际需求配置认证信息
    };

    /**
     * WebSocket客户端类
     */
    class WSClient {
        constructor(options = {}) {
            // 参数验证
            if (options !== null && typeof options !== 'object') {
                throw new TypeError('WSClient: options must be an object');
            }

            this.config = { ...DEFAULT_CONFIG, ...(options || {}) };
            
            // 验证配置
            this._validateConfig();

            // WebSocket实例
            this.ws = null;
            this.state = WSState.CLOSED;
            
            // 事件监听器
            this._listeners = new Map();
            
            // 重连相关
            this._reconnectCount = 0;
            this._reconnectTimer = null;
            this._connectionTimer = null;
            
            // 心跳相关
            this._heartbeatTimer = null;
            this._lastPongTime = 0;
            this._lastPingTime = 0;
            
            // 数据缓冲
            this._sendQueue = [];
            this._isSending = false;
            
            // 识别结果缓存
            this._recognitionResults = [];
            this._maxResultsSize = 1000; // 最大结果数限制，防止内存溢出
            
            // 结束信号标志（用于离线模式判断最终结果）
            this._endSignalSent = false;
            
            // 连接参数（在连接时发送）
            this._connectionParams = null;
            
            // 防止重复连接
            this._isConnecting = false;
            
            // 连接成功Promise的resolve/reject
            this._connectResolve = null;
            this._connectReject = null;
            
            // 销毁标志
            this._isDestroyed = false;
            
            // 浏览器在线状态
            this._isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
            
            // 绑定浏览器在线/离线事件
            this._bindOnlineEvents();
        }

        /**
         * 验证配置参数
         * @private
         */
        _validateConfig() {
            // 验证URL
            if (!this.config.url || typeof this.config.url !== 'string') {
                throw new Error('WSClient: url is required and must be a string');
            }

            // 验证数值参数
            if (typeof this.config.reconnectAttempts !== 'number' || this.config.reconnectAttempts < 0) {
                console.warn('WSClient: Invalid reconnectAttempts, using default 3');
                this.config.reconnectAttempts = 3;
            }

            if (typeof this.config.reconnectDelay !== 'number' || this.config.reconnectDelay < 0) {
                console.warn('WSClient: Invalid reconnectDelay, using default 3000');
                this.config.reconnectDelay = 3000;
            }

            if (typeof this.config.connectionTimeout !== 'number' || this.config.connectionTimeout < 0) {
                console.warn('WSClient: Invalid connectionTimeout, using default 10000');
                this.config.connectionTimeout = 10000;
            }

            if (typeof this.config.heartbeatInterval !== 'number' || this.config.heartbeatInterval < 0) {
                console.warn('WSClient: Invalid heartbeatInterval, using default 30000');
                this.config.heartbeatInterval = 30000;
            }
        }

        /**
         * 检查实例是否已被销毁
         * @private
         */
        _checkDestroyed() {
            if (this._isDestroyed) {
                throw new Error('WSClient: Instance has been destroyed');
            }
        }

        /**
         * 绑定浏览器在线/离线事件
         */
        _bindOnlineEvents() {
            // 检查是否在浏览器环境中
            if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
                return;
            }

            this._handleOnline = () => {
                console.log('WSClient: Browser went online');
                this._isOnline = true;
                this._emit('online');
                
                // 如果当前未连接，尝试重新连接
                if (this.state === WSState.CLOSED && !this._isConnecting && !this._isDestroyed) {
                    console.log('WSClient: Auto-reconnecting after going online');
                    this._scheduleReconnect();
                }
            };
            
            this._handleOffline = () => {
                console.log('WSClient: Browser went offline');
                this._isOnline = false;
                this._emit('offline');
                
                // 清理当前连接
                if (this.state !== WSState.CLOSED && !this._isDestroyed) {
                    this._cleanupWebSocket();
                }
            };
            
            window.addEventListener('online', this._handleOnline);
            window.addEventListener('offline', this._handleOffline);
        }

        /**
         * 解绑浏览器在线/离线事件
         */
        _unbindOnlineEvents() {
            if (typeof window === 'undefined' || typeof window.removeEventListener !== 'function') {
                return;
            }
            
            if (this._handleOnline) {
                window.removeEventListener('online', this._handleOnline);
            }
            if (this._handleOffline) {
                window.removeEventListener('offline', this._handleOffline);
            }
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
                        console.error(`WSClient: Error in ${event} listener:`, error);
                    }
                });
            }
        }

        /**
         * 验证WebSocket URL
         */
        _validateUrl(url) {
            if (!url) {
                return { valid: false, error: 'URL不能为空' };
            }

            const wsPattern = /^wss?:\/\/.+/i;
            if (!wsPattern.test(url)) {
                return { valid: false, error: 'URL格式不正确，必须以ws://或wss://开头' };
            }

            try {
                const urlObj = new URL(url);

                // 安全检查：非本地环境使用 ws:// 时发出警告
                const hostname = urlObj.hostname;
                const isLocalhost = hostname === 'localhost' ||
                                   hostname === '127.0.0.1' ||
                                   hostname === '[::1]' ||
                                   hostname === '0.0.0.0';

                if (urlObj.protocol === 'ws:' && !isLocalhost) {
                    console.warn('WSClient: 在非本地环境使用未加密的 WebSocket (ws://) 连接，数据可能被窃听。建议使用 wss://');
                }

                return { valid: true };
            } catch (e) {
                return { valid: false, error: 'URL格式不正确' };
            }
        }

        /**
         * 建立WebSocket连接
         * @param {Object} params - 连接参数
         * @returns {Promise} 连接结果
         */
        connect(params = {}) {
            this._checkDestroyed();

            return new Promise((resolve, reject) => {
                try {
                    // 检查浏览器在线状态
                    if (!this._isOnline) {
                        reject(new Error('浏览器处于离线状态'));
                        return;
                    }
                    
                    // 防止重复连接
                    if (this._isConnecting) {
                        reject(new Error('正在连接中，请稍候'));
                        return;
                    }

                    // 如果已经连接，直接返回成功
                    if (this.ws && this.state === WSState.OPEN) {
                        resolve();
                        return;
                    }

                    // 验证URL
                    const urlValidation = this._validateUrl(this.config.url);
                    if (!urlValidation.valid) {
                        reject(new Error(urlValidation.error));
                        return;
                    }

                    this._isConnecting = true;
                    this._connectResolve = resolve;
                    this._connectReject = reject;

                    // 如果正在关闭，等待关闭完成后再连接
                    if (this.state === WSState.CLOSING) {
                        setTimeout(() => {
                            if (!this._isDestroyed) {
                                this._doConnect(params);
                            }
                        }, 100);
                    } else {
                        this._doConnect(params);
                    }
                } catch (error) {
                    this._isConnecting = false;
                    reject(error);
                }
            });
        }

        /**
         * 构建带查询参数的 WebSocket URL
         */
        _buildWebSocketUrl(baseUrl, headers = {}) {
            try {
                const url = new URL(baseUrl);
                
                // 添加查询参数
                Object.entries(headers).forEach(([key, value]) => {
                    if (value !== undefined && value !== null) {
                        url.searchParams.set(key, String(value));
                    }
                });
                
                return url.toString();
            } catch (error) {
                console.error('WSClient: Failed to build WebSocket URL:', error);
                return baseUrl;
            }
        }

        /**
         * 执行连接
         * @param {Object} params - 连接参数
         * @private
         */
        _doConnect(params) {
            if (this._isDestroyed) {
                return;
            }

            try {
                // 如果已连接，先断开
                if (this.ws) {
                    this._cleanupWebSocket();
                }

                // 保存连接参数
                this._connectionParams = {
                    mode: params.mode || this.config.mode,
                    wav_name: params.wavName || this.config.wavName,
                    wav_format: params.wavFormat || this.config.wavFormat,
                    audio_fs: params.audioFs || this.config.audioFs,
                    is_speaking: true,
                    chunk_size: this.config.chunkSize,
                    chunk_interval: this.config.chunkInterval,
                    itn: params.itn !== undefined ? params.itn : this.config.itn,
                    hotwords: params.hotwords || this.config.hotwords
                };

                this.state = WSState.CONNECTING;
                this._emit('connecting');

                // 构建带查询参数的 URL
                const wsUrl = this._buildWebSocketUrl(
                    this.config.url, 
                    { ...this.config.headers, ...params.headers }
                );
                
                this.ws = new WebSocket(wsUrl);
                
                // 设置连接超时
                this._connectionTimer = setTimeout(() => {
                    if (this.state === WSState.CONNECTING) {
                        this._cleanupWebSocket();
                        const error = new Error('连接超时');
                        this._emit('error', error);
                        if (this._connectReject) {
                            this._connectReject(error);
                            this._connectResolve = null;
                            this._connectReject = null;
                        }
                    }
                }, this.config.connectionTimeout);

                this.ws.onopen = this._onOpen.bind(this);
                this.ws.onclose = this._onClose.bind(this);
                this.ws.onerror = this._onError.bind(this);
                this.ws.onmessage = this._onMessage.bind(this);

            } catch (error) {
                this.state = WSState.CLOSED;
                this._isConnecting = false;
                this._emit('error', error);
                if (this._connectReject) {
                    this._connectReject(error);
                    this._connectResolve = null;
                    this._connectReject = null;
                }
            }
        }

        /**
         * 连接成功处理
         */
        _onOpen() {
            clearTimeout(this._connectionTimer);
            this._connectionTimer = null;
            
            this.state = WSState.OPEN;
            this._reconnectCount = 0;
            this._isConnecting = false;
            this._endSignalSent = false; // 连接成功后重置结束信号标志
            
            console.log('[WSClient Debug] Connection opened');
            
            // 发送连接参数
            let paramsSent = false;
            console.log('[WSClient Debug] _connectionParams:', JSON.stringify(this._connectionParams));
            if (this._connectionParams) {
                const sent = this._sendJson(this._connectionParams);
                console.log('[WSClient Debug] _sendJson result:', sent);
                if (sent) {
                    paramsSent = true;
                    console.log('[WSClient Debug] Connection params sent:', JSON.stringify(this._connectionParams));
                } else {
                    console.warn('[WSClient Debug] Failed to send connection params');
                }
            } else {
                console.warn('[WSClient Debug] _connectionParams is undefined');
            }
            
            // 启动心跳
            this._startHeartbeat();
            
            // 处理发送队列
            this._processSendQueue();
            
            this._emit('open');
            
            // 只有在连接参数发送成功后才触发 connected 事件
            // 添加延迟确保参数先到达服务器
            const delay = paramsSent ? 500 : 100;
            setTimeout(() => {
                this._emit('connected');
            }, delay);
            
            if (this._connectResolve) {
                this._connectResolve();
                this._connectResolve = null;
                this._connectReject = null;
            }
        }

        /**
         * 连接关闭处理
         */
        _onClose(event) {
            clearTimeout(this._connectionTimer);
            this._connectionTimer = null;
            this._stopHeartbeat();
            
            const wasConnected = this.state === WSState.OPEN;
            const wasConnecting = this.state === WSState.CONNECTING;
            this.state = WSState.CLOSED;
            this._isConnecting = false;
            
            console.log(`WSClient: Connection closed, code: ${event.code}, reason: ${event.reason}`);
            
            // 如果正在连接过程中被关闭，reject Promise
            if (wasConnecting && this._connectReject) {
                const error = new Error(`连接失败: ${event.reason || '连接被拒绝'}`);
                this._connectReject(error);
                this._connectResolve = null;
                this._connectReject = null;
            }
            
            this._emit('close', {
                code: event.code,
                reason: event.reason,
                wasClean: event.wasClean
            });

            // 尝试重连
            if (wasConnected && this._reconnectCount < this.config.reconnectAttempts) {
                this._scheduleReconnect();
            }
        }

        /**
         * 连接错误处理
         */
        _onError(error) {
            console.error('WSClient: Connection error:', error);
            
            // 注意：WebSocket的错误事件不会提供详细信息
            // 详细的错误信息通常在close事件中
            
            this._emit('error', error);
            
            // 如果正在连接，由onClose处理reject
        }

        /**
         * 消息接收处理
         * @param {MessageEvent} event - WebSocket消息事件
         * @private
         */
        _onMessage(event) {
            try {
                // 验证事件数据
                if (!event || !event.data) {
                    console.warn('WSClient: Received empty message event');
                    return;
                }

                let data;
                try {
                    data = JSON.parse(event.data);
                } catch (parseError) {
                    console.error('WSClient: Failed to parse message:', parseError);
                    this._emit('error', new Error(`消息解析失败: ${parseError.message}`));
                    return;
                }
                
                // 验证解析后的数据
                if (!data || typeof data !== 'object') {
                    console.warn('WSClient: Received invalid message data');
                    return;
                }
                
                // 处理识别结果
                if (data.text !== undefined) {
                    this._handleRecognitionResult(data);
                }
                
                // 处理心跳响应
                if (data.type === 'pong') {
                    this._lastPongTime = Date.now();
                }
                
                this._emit('message', data);
                
            } catch (error) {
                console.error('WSClient: Error handling message:', error);
                this._emit('error', new Error(`消息处理失败: ${error.message}`));
            }
        }

        /**
         * 处理识别结果
         * @param {Object} data - 服务器返回的原始数据
         * @private
         */
        _handleRecognitionResult(data) {
            try {
                // 参数验证
                if (!data || typeof data !== 'object') {
                    console.warn('WSClient: Invalid recognition data received');
                    return;
                }

                console.log('[WSClient Debug] ========== _handleRecognitionResult ==========');
                console.log('[WSClient Debug] 原始data:', JSON.stringify(data));

                // 使用服务器返回的mode
                const resultMode = data.mode || 'offline';

                const result = {
                    mode: resultMode,
                    wavName: data.wav_name,
                    text: data.text,
                    isFinal: data.is_final || false,
                    timestamp: data.timestamp,
                    stampSents: data.stamp_sents,
                    receiveTime: Date.now()
                };

                console.log('[WSClient Debug] 解析后的result:', JSON.stringify(result));
                console.log('[WSClient Debug] result.mode:', result.mode);
                console.log('[WSClient Debug] this.config.mode:', this.config.mode);

                this._recognitionResults.push(result);
                // 限制结果数组大小防止内存溢出
                if (this._recognitionResults.length > this._maxResultsSize) {
                    this._recognitionResults = this._recognitionResults.slice(-this._maxResultsSize);
                }

                // 触发result事件，用于实时显示
                this._emit('result', result);

                // 判断是否为最终结果（仅触发complete事件，不影响实时显示）：
                // 1. mode 为 "2pass-offline"（2pass模式的第二遍离线精识别结果）
                // 注意：不依赖 is_final，因为服务器可能在2pass-online模式下也设置is_final
                const isComplete = result.mode === '2pass-offline';

                if (isComplete) {
                    console.log('[WSClient Debug] 触发 complete 事件');
                    // 重置结束信号标志
                    this._endSignalSent = false;
                    this._emit('complete', result);
                }
            } catch (error) {
                console.error('WSClient: Error handling recognition result:', error);
                this._emit('error', new Error(`处理识别结果失败: ${error.message}`));
            }
        }

        /**
         * 发送JSON数据（带超时）
         * @param {Object} data - 要发送的数据
         * @param {number} timeout - 超时时间（毫秒）
         * @returns {boolean} 发送是否成功
         */
        _sendJson(data, timeout = this.config.sendTimeout) {
            // 检查实例是否已销毁
            if (this._isDestroyed) {
                console.warn('WSClient: Cannot send data, instance destroyed');
                return false;
            }

            // 检查 WebSocket 实例是否存在
            if (!this.ws) {
                console.warn('WSClient: Cannot send data, WebSocket not initialized');
                return false;
            }
            
            if (this.state !== WSState.OPEN) {
                console.warn('WSClient: Cannot send data, WebSocket not open');
                return false;
            }
            
            try {
                // 验证数据可以序列化
                let jsonStr;
                try {
                    jsonStr = JSON.stringify(data);
                } catch (serializeError) {
                    console.error('WSClient: Failed to serialize data:', serializeError);
                    return false;
                }

                this.ws.send(jsonStr);
                return true;
            } catch (error) {
                console.error('WSClient: Failed to send JSON data:', error);
                return false;
            }
        }

        /**
         * 发送音频数据（带超时）
         * @param {Int16Array|ArrayBuffer} audioData - 音频数据
         * @param {number} timeout - 超时时间（毫秒）
         * @returns {boolean} 发送是否成功
         */
        sendAudio(audioData, timeout = this.config.sendTimeout) {
            // 检查实例是否已销毁
            if (this._isDestroyed) {
                console.warn('WSClient: Cannot send audio, instance destroyed');
                return false;
            }

            // 验证音频数据
            if (!audioData) {
                console.warn('WSClient: Cannot send audio, data is empty');
                return false;
            }

            // 检查 WebSocket 实例是否存在
            if (!this.ws) {
                console.warn('WSClient: Cannot send audio, WebSocket not initialized');
                return false;
            }
            
            if (this.state !== WSState.OPEN) {
                // 如果未连接，加入发送队列
                if (this._sendQueue.length < this.config.maxQueueSize) {
                    this._sendQueue.push(audioData);
                }
                return false;
            }
            
            try {
                // 将 Int16Array 转换为 ArrayBuffer 发送
                let buffer;
                if (audioData instanceof Int16Array) {
                    buffer = audioData.buffer;
                } else if (audioData instanceof ArrayBuffer) {
                    buffer = audioData;
                } else {
                    console.warn('WSClient: Invalid audio data type, expected Int16Array or ArrayBuffer');
                    return false;
                }
                
                this.ws.send(buffer);
                return true;
            } catch (error) {
                console.error('WSClient: Failed to send audio data:', error);
                // 发送失败，加入队列稍后重试
                if (this._sendQueue.length < this.config.maxQueueSize) {
                    this._sendQueue.push(audioData);
                }
                return false;
            }
        }

        /**
         * 处理发送队列
         */
        _processSendQueue() {
            while (this._sendQueue.length > 0 && this.state === WSState.OPEN) {
                const data = this._sendQueue.shift();
                try {
                    // 将 Int16Array 转换为 ArrayBuffer 发送
                    let buffer;
                    if (data instanceof Int16Array) {
                        buffer = data.buffer;
                    } else if (data instanceof ArrayBuffer) {
                        buffer = data;
                    } else {
                        continue;
                    }
                    this.ws.send(buffer);
                } catch (error) {
                    // 将数据放回队列头部
                    this._sendQueue.unshift(data);
                    break;
                }
            }
        }

        /**
         * 发送录音结束标识
         */
        sendEndSignal() {
            const endSignal = {
                is_speaking: false
            };
            
            // 标记已发送结束信号，下一条收到的消息将作为最终结果
            this._endSignalSent = true;
            
            return this._sendJson(endSignal);
        }

        /**
         * 启动心跳
         */
        _startHeartbeat() {
            // 先停止已有心跳，防止重复启动
            this._stopHeartbeat();
            
            this._lastPongTime = Date.now();
            this._lastPingTime = Date.now();
            
            this._heartbeatTimer = setInterval(() => {
                if (this.state !== WSState.OPEN) {
                    return;
                }
                
                // 检查心跳响应超时
                const timeSinceLastPong = Date.now() - this._lastPongTime;
                if (timeSinceLastPong > this.config.heartbeatInterval * 2) {
                    this._cleanupWebSocket();
                    // 触发重连
                    this._scheduleReconnect();
                    return;
                }
                
                // 发送心跳
                this._lastPingTime = Date.now();
                this._sendJson({ type: 'ping' });
                
            }, this.config.heartbeatInterval);
        }

        /**
         * 停止心跳
         */
        _stopHeartbeat() {
            if (this._heartbeatTimer) {
                clearInterval(this._heartbeatTimer);
                this._heartbeatTimer = null;
            }
        }

        /**
         * 计划重连
         */
        _scheduleReconnect() {
            this._reconnectCount++;
            
            this._reconnectTimer = setTimeout(() => {
                this._emit('reconnecting', { attempt: this._reconnectCount });
                
                this.connect(this._connectionParams).catch(error => {
                    console.error('WSClient: Reconnect failed:', error);
                });
            }, this.config.reconnectDelay);
        }

        /**
         * 清理WebSocket资源
         */
        _cleanupWebSocket() {
            if (this.ws) {
                // 移除事件监听
                this.ws.onopen = null;
                this.ws.onclose = null;
                this.ws.onerror = null;
                this.ws.onmessage = null;
                
                // 如果还在连接中，关闭连接
                if (this.ws.readyState === WSState.CONNECTING || this.ws.readyState === WSState.OPEN) {
                    try {
                        this.ws.close(1000, 'Client cleanup');
                    } catch (e) {
                        // 忽略关闭错误
                    }
                }
                
                this.ws = null;
            }
        }

        /**
         * 断开连接
         */
        disconnect() {
            // 清除重连定时器
            if (this._reconnectTimer) {
                clearTimeout(this._reconnectTimer);
                this._reconnectTimer = null;
            }
            
            // 重置重连计数
            this._reconnectCount = this.config.reconnectAttempts; // 防止自动重连
            
            // 停止心跳
            this._stopHeartbeat();
            
            // 清理WebSocket
            this._cleanupWebSocket();
            
            // 清空队列
            this._sendQueue = [];
            
            this.state = WSState.CLOSED;
            this._isConnecting = false;
            
            this._emit('disconnected');
        }

        /**
         * 获取连接状态
         */
        getState() {
            return {
                state: this.state,
                connected: this.state === WSState.OPEN,
                reconnectCount: this._reconnectCount,
                queueLength: this._sendQueue.length,
                isConnecting: this._isConnecting,
                isOnline: this._isOnline
            };
        }

        /**
         * 获取识别结果
         */
        getResults() {
            return [...this._recognitionResults];
        }

        /**
         * 清空识别结果
         */
        clearResults() {
            this._recognitionResults = [];
        }

        /**
         * 更新配置
         */
        updateConfig(newConfig) {
            this.config = { ...this.config, ...newConfig };
        }

        /**
         * 更新请求头（URL查询参数）
         * WebSocket不支持HTTP请求头，通过URL查询参数传递额外信息
         */
        updateHeaders(headers) {
            this.config.headers = { ...this.config.headers, ...headers };
            console.log('WSClient: Headers updated:', this.config.headers);
        }

        /**
         * 设置单个请求头
         */
        setHeader(key, value) {
            this.config.headers[key] = value;
        }

        /**
         * 获取当前请求头
         */
        getHeaders() {
            return { ...this.config.headers };
        }

        /**
         * 清除所有请求头
         */
        clearHeaders() {
            this.config.headers = {};
        }

        /**
         * 销毁客户端
         */
        destroy() {
            if (this._isDestroyed) {
                return;
            }

            this._isDestroyed = true;

            try {
                // 解绑浏览器事件
                this._unbindOnlineEvents();
                
                // 断开连接
                this.disconnect();
                
                // 清除所有定时器
                if (this._reconnectTimer) {
                    clearTimeout(this._reconnectTimer);
                    this._reconnectTimer = null;
                }
                if (this._connectionTimer) {
                    clearTimeout(this._connectionTimer);
                    this._connectionTimer = null;
                }
                if (this._heartbeatTimer) {
                    clearInterval(this._heartbeatTimer);
                    this._heartbeatTimer = null;
                }
                
                // 清理数据
                this._listeners.clear();
                this._recognitionResults = [];
                this._sendQueue = [];
                
                // 清理引用
                this.ws = null;
                this._connectionParams = null;
                this._connectResolve = null;
                this._connectReject = null;
                
                console.log('WSClient: Client destroyed');
            } catch (error) {
                console.error('WSClient: Error during destroy:', error);
            }
        }
    }

    // 导出到全局
    window.WSClient = WSClient;
    window.WSState = WSState;

})(window);


// ==================== audioRecorder.js ====================

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
            // 参数验证
            if (options !== null && typeof options !== 'object') {
                throw new TypeError('AudioRecorder: options must be an object');
            }

            this.config = { ...DEFAULT_CONFIG, ...(options || {}) };
            
            // 验证配置
            this._validateConfig();

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

            // 销毁标志
            this._isDestroyed = false;
        }

        /**
         * 验证配置参数
         * @private
         */
        _validateConfig() {
            // 验证采样率
            if (typeof this.config.sampleRate !== 'number' || this.config.sampleRate <= 0) {
                console.warn('AudioRecorder: Invalid sampleRate, using default 16000');
                this.config.sampleRate = 16000;
            }

            // 验证缓冲区大小
            const validBufferSizes = [256, 512, 1024, 2048, 4096, 8192, 16384];
            if (!validBufferSizes.includes(this.config.bufferSize)) {
                console.warn(`AudioRecorder: Invalid bufferSize ${this.config.bufferSize}, using default 4096`);
                this.config.bufferSize = 4096;
            }

            // 验证时长参数
            if (typeof this.config.chunkDuration !== 'number' || this.config.chunkDuration <= 0) {
                console.warn('AudioRecorder: Invalid chunkDuration, using default 100');
                this.config.chunkDuration = 100;
            }

            if (typeof this.config.maxDuration !== 'number' || this.config.maxDuration <= 0) {
                console.warn('AudioRecorder: Invalid maxDuration, using default 600000');
                this.config.maxDuration = 600000;
            }
        }

        /**
         * 检查实例是否已被销毁
         * @private
         */
        _checkDestroyed() {
            if (this._isDestroyed) {
                throw new Error('AudioRecorder: Instance has been destroyed');
            }
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
         * @returns {Object} 支持情况
         */
        checkSupport() {
            const support = {
                getUserMedia: !!(typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
                audioContext: !!(typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)),
                webAudio: !!(typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
            };
            
            return {
                supported: support.getUserMedia && support.audioContext,
                details: support
            };
        }

        /**
         * 初始化录音器
         * @returns {Promise} 初始化结果
         */
        async init() {
            this._checkDestroyed();

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

            // 检查浏览器环境
            if (typeof window === 'undefined' || typeof navigator === 'undefined') {
                throw new Error('AudioRecorder: Must run in a browser environment');
            }

            // 检查支持情况
            const support = this.checkSupport();
            if (!support.supported) {
                const error = new Error('浏览器不支持音频录制功能');
                error.details = support.details;
                throw error;
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
                        // 验证媒体流
                        if (!stream || !stream.getAudioTracks || stream.getAudioTracks().length === 0) {
                            throw new Error('无法获取音频轨道');
                        }

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
                                try {
                                    this._processAudioData(e.inputBuffer);
                                } catch (processError) {
                                    console.error('AudioRecorder: Error in audio process:', processError);
                                }
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
                        error.isNotFound = err.name === 'NotFoundError';
                        error.isNotReadable = err.name === 'NotReadableError';
                        
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
         * @returns {Promise} 开始录音结果
         */
        async start() {
            this._checkDestroyed();

            if (this.state === RecorderState.RECORDING) {
                console.warn('AudioRecorder: Already recording');
                return;
            }

            if (this.state === RecorderState.ERROR) {
                throw new Error('录音器处于错误状态，请重新初始化');
            }

            try {
                if (!this.audioContext) {
                    await this.init();
                }

                // 验证初始化成功
                if (!this.audioContext) {
                    throw new Error('AudioContext not initialized');
                }

                // 确保处于空闲状态
                if (this.state !== RecorderState.IDLE && this.state !== RecorderState.PAUSED) {
                    throw new Error(`无法开始录音，当前状态: ${this.state}`);
                }

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
            if (this._isDestroyed) {
                return Promise.resolve();
            }

            this._isDestroyed = true;

            return this.close().then(() => {
                this._listeners.clear();
                this._onProcessCallback = null;
                this.sampleBuffer = [];
            }).catch(error => {
                console.error('AudioRecorder: Error during destroy:', error);
                // 即使出错也要清理
                this._listeners.clear();
                this._onProcessCallback = null;
                this.sampleBuffer = [];
            });
        }
    }

    // 导出到全局
    window.AudioRecorder = AudioRecorder;
    window.RecorderState = RecorderState;

})(window);


// ==================== app.js ====================

/**
 * FunASR语音识别SDK - FunASRController
 * 提供独立的语音识别功能，不依赖特定UI
 * 
 * 使用示例:
 * const asr = new FunASRController({
 *     wsUrl: 'ws://127.0.0.1:10095/',
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
        wsUrl: 'ws://127.0.0.1:10095/',
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
