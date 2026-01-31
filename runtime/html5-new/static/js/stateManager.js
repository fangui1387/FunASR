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
