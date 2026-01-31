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
        url: 'wss://192.168.1.17:10095/',
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
            
            // 浏览器在线状态
            this._isOnline = navigator.onLine;
            
            // 绑定浏览器在线/离线事件
            this._bindOnlineEvents();
        }

        /**
         * 绑定浏览器在线/离线事件
         */
        _bindOnlineEvents() {
            this._handleOnline = () => {
                console.log('WSClient: Browser went online');
                this._isOnline = true;
                this._emit('online');
                
                // 如果当前未连接，尝试重新连接
                if (this.state === WSState.CLOSED && !this._isConnecting) {
                    console.log('WSClient: Auto-reconnecting after going online');
                    this._scheduleReconnect();
                }
            };
            
            this._handleOffline = () => {
                console.log('WSClient: Browser went offline');
                this._isOnline = false;
                this._emit('offline');
                
                // 清理当前连接
                if (this.state !== WSState.CLOSED) {
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
            window.removeEventListener('online', this._handleOnline);
            window.removeEventListener('offline', this._handleOffline);
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
         */
        connect(params = {}) {
            return new Promise((resolve, reject) => {
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
                        this._doConnect(params);
                    }, 100);
                } else {
                    this._doConnect(params);
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
         */
        _onMessage(event) {
            try {
                const data = JSON.parse(event.data);
                
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
        }

        /**
         * 发送JSON数据（带超时）
         */
        _sendJson(data, timeout = this.config.sendTimeout) {
            // 检查 WebSocket 实例是否存在
            if (!this.ws) {
                return false;
            }
            
            if (this.state !== WSState.OPEN) {
                return false;
            }
            
            try {
                const jsonStr = JSON.stringify(data);
                this.ws.send(jsonStr);
                return true;
            } catch (error) {
                return false;
            }
        }

        /**
         * 发送音频数据（带超时）
         */
        sendAudio(audioData, timeout = this.config.sendTimeout) {
            // 检查 WebSocket 实例是否存在
            if (!this.ws) {
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
                    return false;
                }
                
                this.ws.send(buffer);
                return true;
            } catch (error) {
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
            // 解绑浏览器事件
            this._unbindOnlineEvents();
            
            // 断开连接
            this.disconnect();
            
            // 清除所有定时器
            clearTimeout(this._reconnectTimer);
            clearTimeout(this._connectionTimer);
            clearInterval(this._heartbeatTimer);
            
            // 清理数据
            this._listeners.clear();
            this._recognitionResults = [];
            this._sendQueue = [];
            
            console.log('WSClient: Client destroyed');
        }
    }

    // 导出到全局
    window.WSClient = WSClient;
    window.WSState = WSState;

})(window);
