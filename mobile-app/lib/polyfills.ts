/**
 * Polyfills for React Native environment
 * Must be imported at app entry point before other imports
 */

import 'react-native-get-random-values';
import { Buffer } from 'buffer';

// Ensure Buffer.subarray maintains Buffer prototype
if (typeof Buffer.prototype.subarray !== 'function') {
  Buffer.prototype.subarray = function (begin?: number, end?: number) {
    const result = Uint8Array.prototype.subarray.call(this, begin, end);
    Object.setPrototypeOf(result, Buffer.prototype);
    return result as Buffer;
  };
}

// Make Buffer globally available
global.Buffer = global.Buffer || Buffer;
