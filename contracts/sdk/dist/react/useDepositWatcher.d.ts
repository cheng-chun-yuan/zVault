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
import { PendingDeposit, WatcherCallbacks, WatcherConfig, DepositStatus } from "../watcher/types";
/**
 * Hook state
 */
export interface UseDepositWatcherState {
    /** All pending deposits */
    deposits: PendingDeposit[];
    /** Whether the watcher is initialized */
    isReady: boolean;
    /** Loading state during initialization */
    isLoading: boolean;
    /** Error state */
    error: Error | null;
}
/**
 * Hook actions
 */
export interface UseDepositWatcherActions {
    /** Create a new deposit to watch */
    createDeposit: (amount: bigint, baseUrl?: string) => Promise<PendingDeposit>;
    /** Manually watch an existing deposit */
    watchDeposit: (deposit: PendingDeposit) => Promise<void>;
    /** Get a deposit by ID */
    getDeposit: (id: string) => PendingDeposit | undefined;
    /** Get deposits by status */
    getDepositsByStatus: (status: DepositStatus) => PendingDeposit[];
    /** Remove a deposit from tracking */
    removeDeposit: (id: string) => Promise<void>;
    /** Mark deposit as verified */
    markVerified: (id: string, leafIndex: number) => Promise<void>;
    /** Mark deposit as claimed */
    markClaimed: (id: string) => Promise<void>;
    /** Manually refresh a deposit's status */
    refreshDeposit: (id: string) => Promise<PendingDeposit | undefined>;
    /** Manually refresh all deposits */
    refreshAll: () => Promise<void>;
}
/**
 * Hook return type
 */
export type UseDepositWatcherReturn = UseDepositWatcherState & UseDepositWatcherActions;
/**
 * Hook options
 */
export interface UseDepositWatcherOptions extends Partial<WatcherConfig> {
    /** Custom callbacks (in addition to hook state updates) */
    callbacks?: WatcherCallbacks;
    /** Auto-initialize on mount (default: true) */
    autoInit?: boolean;
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
export declare function useDepositWatcher(options?: UseDepositWatcherOptions): UseDepositWatcherReturn;
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
export declare function useSingleDeposit(options?: UseDepositWatcherOptions): {
    deposit: PendingDeposit | null | undefined;
    status: DepositStatus | null;
    confirmations: number;
    requiredConfirmations: number;
    txid: string | null;
    isReady: boolean;
    isLoading: boolean;
    isWaiting: boolean;
    isDetected: boolean;
    isConfirming: boolean;
    isConfirmed: boolean;
    isVerified: boolean;
    isClaimed: boolean;
    startDeposit: (amount: bigint, baseUrl?: string) => Promise<PendingDeposit>;
    markVerified: (leafIndex: number) => Promise<void>;
    markClaimed: () => Promise<void>;
    reset: () => void;
};
