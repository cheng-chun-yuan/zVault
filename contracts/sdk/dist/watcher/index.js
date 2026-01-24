"use strict";
/**
 * Deposit Watcher Module
 *
 * Watch Bitcoin deposits in real-time and track confirmation progress.
 *
 * Platform-specific implementations:
 * - Web: Uses localStorage + WebSocket
 * - React Native: Uses AsyncStorage + WebSocket
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAsyncStorage = exports.createNativeWatcher = exports.NativeDepositWatcher = exports.createWebWatcher = exports.WebDepositWatcher = exports.BaseDepositWatcher = exports.generateDepositId = exports.deserializeDeposit = exports.serializeDeposit = exports.DEFAULT_WATCHER_CONFIG = void 0;
// Types
var types_1 = require("./types");
Object.defineProperty(exports, "DEFAULT_WATCHER_CONFIG", { enumerable: true, get: function () { return types_1.DEFAULT_WATCHER_CONFIG; } });
Object.defineProperty(exports, "serializeDeposit", { enumerable: true, get: function () { return types_1.serializeDeposit; } });
Object.defineProperty(exports, "deserializeDeposit", { enumerable: true, get: function () { return types_1.deserializeDeposit; } });
Object.defineProperty(exports, "generateDepositId", { enumerable: true, get: function () { return types_1.generateDepositId; } });
// Base class (for custom implementations)
var base_1 = require("./base");
Object.defineProperty(exports, "BaseDepositWatcher", { enumerable: true, get: function () { return base_1.BaseDepositWatcher; } });
// Web implementation
var web_1 = require("./web");
Object.defineProperty(exports, "WebDepositWatcher", { enumerable: true, get: function () { return web_1.WebDepositWatcher; } });
Object.defineProperty(exports, "createWebWatcher", { enumerable: true, get: function () { return web_1.createWebWatcher; } });
// React Native implementation
var native_1 = require("./native");
Object.defineProperty(exports, "NativeDepositWatcher", { enumerable: true, get: function () { return native_1.NativeDepositWatcher; } });
Object.defineProperty(exports, "createNativeWatcher", { enumerable: true, get: function () { return native_1.createNativeWatcher; } });
Object.defineProperty(exports, "setAsyncStorage", { enumerable: true, get: function () { return native_1.setAsyncStorage; } });
