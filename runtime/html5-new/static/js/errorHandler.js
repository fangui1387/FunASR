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
            this.options = {
                showToast: true,
                logErrors: true,
                autoRecovery: true,
                maxRetries: 3,
                deduplicationWindow: 5000, // 错误去重时间窗口(ms)
                ...options
            };
            
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
         */
        _collectContext() {
            return {
                url: window.location.href,
                userAgent: navigator.userAgent,
                viewport: `${window.innerWidth}x${window.innerHeight}`,
                screenResolution: `${window.screen.width}x${window.screen.height}`,
                online: navigator.onLine,
                language: navigator.language,
                platform: navigator.platform,
                cores: navigator.hardwareConcurrency || 'unknown',
                memory: performance?.memory ? {
                    usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB',
                    totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1048576) + 'MB'
                } : null,
                connection: navigator.connection ? {
                    effectiveType: navigator.connection.effectiveType,
                    downlink: navigator.connection.downlink,
                    rtt: navigator.connection.rtt
                } : null,
                timestamp: new Date().toISOString()
            };
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
         */
        handle(error, context = {}) {
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
                this.showErrorToast(normalizedError);
            }
            
            // 尝试自动恢复
            if (this.options.autoRecovery) {
                this._attemptRecovery(normalizedError);
            }
            
            return normalizedError;
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
         */
        _attemptRecovery(error) {
            const strategy = RecoveryStrategies[error.type];
            if (!strategy || !strategy.retryable) {
                return false;
            }

            const retryCount = this._retryCounts.get(error.type) || 0;
            
            if (retryCount >= (strategy.maxRetries || this.options.maxRetries)) {
                console.log(`ErrorHandler: Max retries reached for ${error.type}`);
                this._retryCounts.delete(error.type);
                return false;
            }

            this._retryCounts.set(error.type, retryCount + 1);
            
            console.log(`ErrorHandler: Attempting recovery for ${error.type}, retry ${retryCount + 1}`);
            
            setTimeout(() => {
                this._emit('recovery', {
                    error: error,
                    retryCount: retryCount + 1,
                    strategy: strategy
                });
            }, strategy.retryDelay || 2000);
            
            return true;
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
            this._listeners.clear();
            this._retryCounts.clear();
            this._errorHistory = [];
            this._errorCache.clear();
            this._contextInfo = null;
        }
    }

    // 导出到全局
    window.ErrorHandler = ErrorHandler;
    window.ErrorType = ErrorType;

})(window);
