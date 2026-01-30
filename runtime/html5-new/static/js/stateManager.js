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
        constructor() {
            // 当前状态
            this._connectionState = ConnectionState.DISCONNECTED;
            this._recordingState = RecordingState.IDLE;
            this._appState = AppState.INITIALIZING;
            
            // 状态变更回调
            this._listeners = new Map();
            
            // 状态历史（用于调试和恢复）
            this._stateHistory = [];
            this._maxHistorySize = 50;
            
            // 初始化
            this._init();
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
         * 触发事件
         */
        _emit(eventName, data) {
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
         */
        setConnectionState(state) {
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
         */
        setRecordingState(state) {
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
         */
        setAppState(state) {
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
            this._listeners.clear();
            this._stateHistory = [];
        }
    }

    // 导出到全局
    window.StateManager = StateManager;
    window.ConnectionState = ConnectionState;
    window.RecordingState = RecordingState;
    window.AppState = AppState;

})(window);
