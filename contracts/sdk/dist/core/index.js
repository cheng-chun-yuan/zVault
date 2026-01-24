"use strict";
/**
 * Core Module - Platform-agnostic utilities
 *
 * Pure functions and clients that work everywhere:
 * - Browser
 * - Node.js
 * - React Native
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.esploraMainnet = exports.esploraTestnet = exports.EsploraClient = void 0;
var esplora_1 = require("./esplora");
Object.defineProperty(exports, "EsploraClient", { enumerable: true, get: function () { return esplora_1.EsploraClient; } });
Object.defineProperty(exports, "esploraTestnet", { enumerable: true, get: function () { return esplora_1.esploraTestnet; } });
Object.defineProperty(exports, "esploraMainnet", { enumerable: true, get: function () { return esplora_1.esploraMainnet; } });
