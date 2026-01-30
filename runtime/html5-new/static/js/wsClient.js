/**
 * WebSocket通信层
 * 负责与FunASR服务器建立WebSocket连接，处理音频数据传输和识别结果接收
 * 严格遵循API.md接口文档规范
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
        url: 'wss://192.168.43.12:10095/',
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
        maxQueueSize: 100 // 最大发送队列大小
    };

    /**
     * WebSocket客户端类
     */
    class WSClient {
        constructor(options = {}) {
            this.config = { ...DEFAULT_CONFIG, ...options };
            
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
            
            // 数据缓冲
            this._sendQueue = [];
            this._isSending = false;
            
            // 识别结果缓存
            this._recognitionResults = [];
            
            // 连接参数（在连接时发送）
            this._connectionParams = null;
            
            // 防止重复连接
            this._isConnecting = false;
            
            // 连接成功Promise的resolve/reject
            this._connectResolve = null;
            this._connectReject = null;
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
                new URL(url);
                return { valid: true };
            } catch (e) {
                return { valid: false, error: 'URL格式不正确' };
            }
        }

        /**
         * 建立WebSocket连接
         */
        connect(params = {}) {
            return new Promise((resolve, reject) => {
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
                        this._doConnect(params);
                    }, 100);
                } else {
                    this._doConnect(params);
                }
            });
        }

        /**
         * 执行连接
         */
        _doConnect(params) {
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

            try {
                this.ws = new WebSocket(this.config.url);
                
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
            
            console.log('WSClient: Connection opened');
            
            // 发送连接参数
            if (this._connectionParams) {
                const sent = this._sendJson(this._connectionParams);
                if (!sent) {
                    console.warn('WSClient: Failed to send connection params');
                }
            }
            
            // 启动心跳
            this._startHeartbeat();
            
            // 处理发送队列
            this._processSendQueue();
            
            this._emit('open');
            this._emit('connected');
            
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
         */
        _onMessage(event) {
            try {
                const data = JSON.parse(event.data);
                
                console.log('WSClient: Received message:', data);
                
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
                console.error('WSClient: Error parsing message:', error);
                this._emit('error', new Error('消息解析失败'));
            }
        }

        /**
         * 处理识别结果
         */
        _handleRecognitionResult(data) {
            const result = {
                mode: data.mode || 'offline',
                wavName: data.wav_name,
                text: data.text,
                isFinal: data.is_final || false,
                timestamp: data.timestamp,
                stampSents: data.stamp_sents,
                receiveTime: Date.now()
            };
            
            this._recognitionResults.push(result);
            this._emit('result', result);
            
            // 如果是最终结果，触发完成事件
            if (result.isFinal || data.mode === 'offline') {
                this._emit('complete', result);
            }
        }

        /**
         * 发送JSON数据
         */
        _sendJson(data) {
            // 检查 WebSocket 实例是否存在
            if (!this.ws) {
                console.warn('WSClient: WebSocket instance is null, cannot send JSON');
                return false;
            }
            
            if (this.state !== WSState.OPEN) {
                console.warn('WSClient: Cannot send, connection not open');
                return false;
            }
            
            try {
                const jsonStr = JSON.stringify(data);
                this.ws.send(jsonStr);
                return true;
            } catch (error) {
                console.error('WSClient: Error sending JSON:', error);
                return false;
            }
        }

        /**
         * 发送音频数据
         */
        sendAudio(audioData) {
            console.log('WSClient: sendAudio called, state:', this.state, 'OPEN:', WSState.OPEN, 'ws:', !!this.ws);
            
            // 检查 WebSocket 实例是否存在
            if (!this.ws) {
                console.warn('WSClient: WebSocket instance is null, cannot send');
                return false;
            }
            
            if (this.state !== WSState.OPEN) {
                console.warn('WSClient: Connection not open, queueing data');
                // 如果未连接，加入发送队列
                if (this._sendQueue.length < this.config.maxQueueSize) {
                    this._sendQueue.push(audioData);
                } else {
                    console.warn('WSClient: Send queue is full, dropping data');
                }
                return false;
            }
            
            try {
                // 将 Int16Array 转换为 ArrayBuffer 发送
                let buffer;
                if (audioData instanceof Int16Array) {
                    buffer = audioData.buffer;
                    console.log('WSClient: Converting Int16Array to ArrayBuffer, byteLength:', buffer.byteLength);
                } else if (audioData instanceof ArrayBuffer) {
                    buffer = audioData;
                    console.log('WSClient: Using ArrayBuffer directly, byteLength:', buffer.byteLength);
                } else {
                    console.warn('WSClient: Unsupported audio data type:', typeof audioData, audioData.constructor.name);
                    return false;
                }
                this.ws.send(buffer);
                console.log('WSClient: Audio data sent successfully');
                return true;
            } catch (error) {
                console.error('WSClient: Error sending audio:', error);
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
                        console.warn('WSClient: Unsupported queued data type:', typeof data);
                        continue;
                    }
                    this.ws.send(buffer);
                } catch (error) {
                    console.error('WSClient: Error sending queued data:', error);
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
            
            return this._sendJson(endSignal);
        }

        /**
         * 启动心跳
         */
        _startHeartbeat() {
            this._lastPongTime = Date.now();
            
            this._heartbeatTimer = setInterval(() => {
                if (this.state !== WSState.OPEN) {
                    return;
                }
                
                // 检查心跳响应超时
                const timeSinceLastPong = Date.now() - this._lastPongTime;
                if (timeSinceLastPong > this.config.heartbeatInterval * 2) {
                    console.warn('WSClient: Heartbeat timeout');
                    this._cleanupWebSocket();
                    return;
                }
                
                // 发送心跳
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
            
            console.log(`WSClient: Scheduling reconnect, attempt ${this._reconnectCount}`);
            
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
                isConnecting: this._isConnecting
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
         * 销毁客户端
         */
        destroy() {
            this.disconnect();
            
            // 清除所有定时器
            clearTimeout(this._reconnectTimer);
            clearTimeout(this._connectionTimer);
            clearInterval(this._heartbeatTimer);
            
            this._listeners.clear();
            this._recognitionResults = [];
            this._sendQueue = [];
        }
    }

    // 导出到全局
    window.WSClient = WSClient;
    window.WSState = WSState;

})(window);
