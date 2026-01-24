"use strict";
/**
 * React Hook for Deposit Watching
 *
 * Universal hook that works in both React (web) and React Native.
 * Automatically detects platform and uses appropriate watcher.
 *
 * Features:
 * - Real-time deposit detection
 * - Confirmation progress tracking
 * - Automatic persistence
 * - TypeScript support
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.useDepositWatcher = useDepositWatcher;
exports.useSingleDeposit = useSingleDeposit;
const react_1 = require("react");
const web_1 = require("../watcher/web");
const native_1 = require("../watcher/native");
/**
 * Detect if running in React Native
 */
function isReactNative() {
    return (typeof navigator !== "undefined" && navigator.product === "ReactNative");
}
/**
 * React hook for watching Bitcoin deposits
 *
 * @param options - Configuration options
 * @returns State and actions for deposit management
 *
 * @example
 * ```tsx
 * function DepositScreen() {
 *   const {
 *     deposits,
 *     isReady,
 *     createDeposit,
 *     getDepositsByStatus,
 *   } = useDepositWatcher({
 *     requiredConfirmations: 6,
 *     callbacks: {
 *       onConfirmed: (deposit) => {
 *         console.log('Ready to verify on Solana!');
 *       },
 *     },
 *   });
 *
 *   const handleDeposit = async () => {
 *     const deposit = await createDeposit(100_000n);
 *     // Show QR code for deposit.taprootAddress
 *   };
 *
 *   const waitingDeposits = getDepositsByStatus('waiting');
 *   const confirmingDeposits = getDepositsByStatus('confirming');
 *   const readyToClaim = getDepositsByStatus('confirmed');
 *
 *   return (
 *     <div>
 *       <button onClick={handleDeposit}>Create Deposit</button>
 *
 *       {confirmingDeposits.map(d => (
 *         <div key={d.id}>
 *           {d.confirmations}/{d.requiredConfirmations} confirmations
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
function useDepositWatcher(options = {}) {
    const { callbacks: userCallbacks, autoInit = true, ...config } = options;
    // State
    const [deposits, setDeposits] = (0, react_1.useState)([]);
    const [isReady, setIsReady] = (0, react_1.useState)(false);
    const [isLoading, setIsLoading] = (0, react_1.useState)(true);
    const [error, setError] = (0, react_1.useState)(null);
    // Watcher ref
    const watcherRef = (0, react_1.useRef)(null);
    // Update deposits state from watcher
    const syncDeposits = (0, react_1.useCallback)(() => {
        if (watcherRef.current) {
            setDeposits([...watcherRef.current.getAllDeposits()]);
        }
    }, []);
    // Combined callbacks that update state and call user callbacks
    const internalCallbacks = {
        onDetected: (deposit) => {
            syncDeposits();
            userCallbacks?.onDetected?.(deposit);
        },
        onConfirming: (deposit, confirmations) => {
            syncDeposits();
            userCallbacks?.onConfirming?.(deposit, confirmations);
        },
        onConfirmed: (deposit) => {
            syncDeposits();
            userCallbacks?.onConfirmed?.(deposit);
        },
        onVerified: (deposit) => {
            syncDeposits();
            userCallbacks?.onVerified?.(deposit);
        },
        onClaimed: (deposit) => {
            syncDeposits();
            userCallbacks?.onClaimed?.(deposit);
        },
        onError: (deposit, err) => {
            syncDeposits();
            userCallbacks?.onError?.(deposit, err);
        },
        onStatusChange: (deposit, oldStatus, newStatus) => {
            syncDeposits();
            userCallbacks?.onStatusChange?.(deposit, oldStatus, newStatus);
        },
    };
    // Initialize watcher on mount
    (0, react_1.useEffect)(() => {
        if (!autoInit) {
            setIsLoading(false);
            return;
        }
        let watcher;
        // Create platform-specific watcher
        if (isReactNative()) {
            watcher = (0, native_1.createNativeWatcher)(internalCallbacks, config);
        }
        else {
            watcher = (0, web_1.createWebWatcher)(internalCallbacks, config);
        }
        watcherRef.current = watcher;
        // Initialize
        watcher
            .init()
            .then(() => {
            setIsReady(true);
            setIsLoading(false);
            syncDeposits();
        })
            .catch((err) => {
            setError(err);
            setIsLoading(false);
        });
        // Cleanup on unmount
        return () => {
            watcher.destroy();
            watcherRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // Actions
    const createDeposit = (0, react_1.useCallback)(async (amount, baseUrl) => {
        if (!watcherRef.current) {
            throw new Error("Watcher not initialized");
        }
        const deposit = await watcherRef.current.createDeposit(amount, baseUrl);
        syncDeposits();
        return deposit;
    }, [syncDeposits]);
    const watchDeposit = (0, react_1.useCallback)(async (deposit) => {
        if (!watcherRef.current) {
            throw new Error("Watcher not initialized");
        }
        await watcherRef.current.watchDeposit(deposit);
        syncDeposits();
    }, [syncDeposits]);
    const getDeposit = (0, react_1.useCallback)((id) => {
        return watcherRef.current?.getDeposit(id);
    }, []);
    const getDepositsByStatus = (0, react_1.useCallback)((status) => {
        return watcherRef.current?.getDepositsByStatus(status) || [];
    }, []);
    const removeDeposit = (0, react_1.useCallback)(async (id) => {
        if (!watcherRef.current) {
            throw new Error("Watcher not initialized");
        }
        await watcherRef.current.removeDeposit(id);
        syncDeposits();
    }, [syncDeposits]);
    const markVerified = (0, react_1.useCallback)(async (id, leafIndex) => {
        if (!watcherRef.current) {
            throw new Error("Watcher not initialized");
        }
        await watcherRef.current.markVerified(id, leafIndex);
        syncDeposits();
    }, [syncDeposits]);
    const markClaimed = (0, react_1.useCallback)(async (id) => {
        if (!watcherRef.current) {
            throw new Error("Watcher not initialized");
        }
        await watcherRef.current.markClaimed(id);
        syncDeposits();
    }, [syncDeposits]);
    const refreshDeposit = (0, react_1.useCallback)(async (id) => {
        if (!watcherRef.current) {
            throw new Error("Watcher not initialized");
        }
        const deposit = await watcherRef.current.refreshDeposit(id);
        syncDeposits();
        return deposit;
    }, [syncDeposits]);
    const refreshAll = (0, react_1.useCallback)(async () => {
        if (!watcherRef.current) {
            throw new Error("Watcher not initialized");
        }
        const allDeposits = watcherRef.current.getAllDeposits();
        for (const deposit of allDeposits) {
            await watcherRef.current.refreshDeposit(deposit.id);
        }
        syncDeposits();
    }, [syncDeposits]);
    return {
        // State
        deposits,
        isReady,
        isLoading,
        error,
        // Actions
        createDeposit,
        watchDeposit,
        getDeposit,
        getDepositsByStatus,
        removeDeposit,
        markVerified,
        markClaimed,
        refreshDeposit,
        refreshAll,
    };
}
/**
 * Simplified hook for a single deposit flow
 *
 * Use when you only need to track one deposit at a time.
 *
 * @example
 * ```tsx
 * function SingleDepositFlow() {
 *   const {
 *     deposit,
 *     status,
 *     confirmations,
 *     isDetected,
 *     isConfirmed,
 *     startDeposit,
 *   } = useSingleDeposit({
 *     requiredConfirmations: 6,
 *   });
 *
 *   return (
 *     <div>
 *       {!deposit && (
 *         <button onClick={() => startDeposit(100_000n)}>
 *           Deposit 0.001 BTC
 *         </button>
 *       )}
 *
 *       {deposit && !isDetected && (
 *         <div>
 *           <p>Send BTC to: {deposit.taprootAddress}</p>
 *           <QRCode value={deposit.taprootAddress} />
 *         </div>
 *       )}
 *
 *       {isDetected && !isConfirmed && (
 *         <p>Confirmations: {confirmations}/6</p>
 *       )}
 *
 *       {isConfirmed && (
 *         <button onClick={handleClaim}>Claim sbBTC!</button>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
function useSingleDeposit(options = {}) {
    const { deposits, isReady, isLoading, createDeposit, markVerified, markClaimed } = useDepositWatcher(options);
    // Track current deposit ID
    const [currentDepositId, setCurrentDepositId] = (0, react_1.useState)(null);
    // Get current deposit
    const deposit = currentDepositId
        ? deposits.find((d) => d.id === currentDepositId)
        : null;
    // Start a new deposit
    const startDeposit = (0, react_1.useCallback)(async (amount, baseUrl) => {
        const newDeposit = await createDeposit(amount, baseUrl);
        setCurrentDepositId(newDeposit.id);
        return newDeposit;
    }, [createDeposit]);
    // Reset to start a new deposit
    const reset = (0, react_1.useCallback)(() => {
        setCurrentDepositId(null);
    }, []);
    // Computed state
    const status = deposit?.status || null;
    const confirmations = deposit?.confirmations || 0;
    const requiredConfirmations = deposit?.requiredConfirmations || 6;
    const txid = deposit?.txid || null;
    const isWaiting = status === "waiting";
    const isDetected = status === "detected" || status === "confirming";
    const isConfirming = status === "confirming";
    const isConfirmed = status === "confirmed";
    const isVerified = status === "verified";
    const isClaimed = status === "claimed";
    return {
        // State
        deposit,
        status,
        confirmations,
        requiredConfirmations,
        txid,
        isReady,
        isLoading,
        // Computed booleans
        isWaiting,
        isDetected,
        isConfirming,
        isConfirmed,
        isVerified,
        isClaimed,
        // Actions
        startDeposit,
        markVerified: (leafIndex) => currentDepositId ? markVerified(currentDepositId, leafIndex) : Promise.resolve(),
        markClaimed: () => currentDepositId ? markClaimed(currentDepositId) : Promise.resolve(),
        reset,
    };
}
