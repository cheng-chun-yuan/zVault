"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  TrendingUp,
  Shield,
  Wallet,
  Clock,
  ArrowDownToLine,
  ArrowUpFromLine,
  Lock,
  Eye,
  EyeOff,
  Info,
  Loader2,
  ChevronDown,
  ChevronUp,
  Search,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useZVaultKeys, useStealthInbox } from "@/hooks/use-zvault";
import { useYieldPool, type PoolStats, type EnrichedPoolPosition } from "@/hooks/use-yield-pool";
import { createStealthMetaAddress, formatBtcAmount } from "@zvault/sdk";
import {
  OperationStatus,
  type PoolOperationStatus,
} from "@/components/earn/OperationStatus";

// Alias for consistency with existing code
const formatBtc = formatBtcAmount;

function formatApy(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function formatDuration(seconds: number): string {
  if (seconds < 3600) return `${seconds}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "< 1 hour ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Pool Stats Card - Shows APY and Epoch only (Total Staked is owner-only)
function PoolStatsCard({ stats }: { stats: PoolStats | null }) {
  if (!stats) {
    return (
      <div className="p-4 bg-muted border border-gray/20 rounded-[16px] animate-pulse">
        <div className="h-6 bg-gray/20 rounded mb-3 w-1/3" />
        <div className="h-8 bg-gray/20 rounded mb-2 w-2/3" />
        <div className="h-4 bg-gray/20 rounded w-1/2" />
      </div>
    );
  }

  return (
    <div className="p-4 bg-muted border border-privacy/20 rounded-[16px]">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-5 h-5 text-privacy" />
        <h2 className="text-body1 text-foreground">zkEarn Pool</h2>
        {stats.paused ? (
          <span className="px-2 py-0.5 bg-btc/10 text-btc text-caption rounded-full">
            Paused
          </span>
        ) : (
          <span className="px-2 py-0.5 bg-green-500/10 text-green-400 text-caption rounded-full">
            Live
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 bg-background/50 rounded-[12px]">
          <p className="text-caption text-gray mb-1">Current APY</p>
          <p className="text-heading6 text-privacy font-mono">
            {formatApy(stats.yieldRateBps)}
          </p>
        </div>
        <div className="p-3 bg-background/50 rounded-[12px]">
          <p className="text-caption text-gray mb-1">Epoch</p>
          <p className="text-heading6 text-foreground font-mono">
            #{stats.currentEpoch.toString()}
          </p>
        </div>
      </div>

      <div className="mt-3 p-3 bg-background/50 rounded-[12px]">
        <p className="text-caption text-gray mb-1">Epoch Duration</p>
        <p className="text-body1 text-foreground font-mono">
          {formatDuration(stats.epochDuration)}
        </p>
      </div>

      {/* Privacy Notice */}
      <div className="mt-4 p-3 bg-privacy/5 border border-privacy/15 rounded-[10px]">
        <div className="flex items-start gap-2">
          <Shield className="w-4 h-4 text-privacy shrink-0 mt-0.5" />
          <div>
            <p className="text-caption text-privacy mb-1">Privacy Guaranteed</p>
            <p className="text-caption text-gray">
              Your positions are discovered using your viewing key via ECDH.
              Only you can see your deposits.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Position Card (Stealth-based) - Display only, no actions for now
function PositionCard({
  position,
  stats,
}: {
  position: EnrichedPoolPosition;
  stats: PoolStats | null;
}) {
  const [showDetails, setShowDetails] = useState(false);

  const epochsStaked = stats
    ? stats.currentEpoch - position.depositEpoch
    : 0n;

  return (
    <div className="p-4 bg-muted border border-gray/20 rounded-[16px] hover:border-privacy/30 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-privacy" />
          <span className="text-body2-semibold text-foreground">Stealth Position</span>
          <span className="px-2 py-0.5 bg-privacy/10 text-privacy text-caption rounded-full">
            #{position.leafIndex}
          </span>
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="p-1.5 rounded-[6px] bg-gray/10 hover:bg-gray/20 transition-colors"
        >
          {showDetails ? (
            <ChevronUp className="w-4 h-4 text-gray" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray" />
          )}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <p className="text-caption text-gray">Principal</p>
          <p className="text-body1 text-foreground font-mono">
            {formatBtc(position.principal)} BTC
          </p>
        </div>
        <div>
          <p className="text-caption text-gray">Earned Yield</p>
          <p className="text-body1 text-privacy font-mono">
            +{formatBtc(position.earnedYield)} BTC
          </p>
        </div>
      </div>

      <div className="p-2 bg-privacy/10 rounded-[8px]">
        <div className="flex items-center justify-between">
          <span className="text-caption text-gray">Total Value</span>
          <span className="text-body1-semibold text-privacy font-mono">
            {formatBtc(position.currentValue)} BTC
          </span>
        </div>
      </div>

      {showDetails && (
        <div className="p-3 bg-background/50 rounded-[10px] mt-3 space-y-2">
          <div className="flex justify-between text-caption">
            <span className="text-gray">Deposit Epoch</span>
            <span className="text-foreground font-mono">
              #{position.depositEpoch.toString()}
            </span>
          </div>
          <div className="flex justify-between text-caption">
            <span className="text-gray">Epochs Staked</span>
            <span className="text-foreground font-mono">
              {epochsStaked.toString()}
            </span>
          </div>
          <div className="flex justify-between text-caption">
            <span className="text-gray">Deposited</span>
            <span className="text-foreground font-mono">
              {formatTimeAgo(position.createdAt)}
            </span>
          </div>
          <div className="flex justify-between text-caption">
            <span className="text-gray">Discovery</span>
            <span className="text-privacy">
              <Eye className="w-3 h-3 inline mr-1" />
              Viewing Key ECDH
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Deposit Modal
function DepositModal({
  isOpen,
  onClose,
  onDeposit,
  availableNotes,
  isLoading,
}: {
  isOpen: boolean;
  onClose: () => void;
  onDeposit: (noteIndex: number) => void;
  availableNotes: Array<{ amount: bigint; id: string }>;
  isLoading: boolean;
}) {
  const [selectedNote, setSelectedNote] = useState<number | null>(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-gray/30 rounded-[20px] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-heading6 text-foreground">Deposit to Earn</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray/20 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-gray" />
          </button>
        </div>

        <p className="text-body2 text-gray mb-4">
          Select a zkBTC note to deposit into the yield pool. Your position will use
          a stealth address - only your viewing key can discover it.
        </p>

        {availableNotes.length === 0 ? (
          <div className="p-4 bg-muted rounded-[12px] text-center">
            <Wallet className="w-8 h-8 text-gray mx-auto mb-2" />
            <p className="text-body2 text-gray">No zkBTC notes available</p>
            <Link
              href="/bridge/deposit"
              className="inline-block mt-3 px-4 py-2 bg-btc/20 text-btc text-caption rounded-[8px]"
            >
              Deposit BTC first
            </Link>
          </div>
        ) : (
          <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
            {availableNotes.map((note, index) => (
              <button
                key={note.id}
                onClick={() => setSelectedNote(index)}
                className={cn(
                  "w-full p-3 rounded-[10px] text-left transition-colors",
                  "border",
                  selectedNote === index
                    ? "bg-privacy/10 border-privacy/30"
                    : "bg-muted border-gray/20 hover:border-gray/40"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-body2 text-foreground">
                    {formatBtc(note.amount)} BTC
                  </span>
                  {selectedNote === index && (
                    <span className="text-privacy text-caption">Selected</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray/20 hover:bg-gray/30 text-gray-light rounded-[10px] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => selectedNote !== null && onDeposit(selectedNote)}
            disabled={isLoading || selectedNote === null}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-[10px]",
              "bg-privacy hover:bg-privacy/80 text-background",
              "disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <ArrowDownToLine className="w-4 h-4" />
                Deposit
              </>
            )}
          </button>
        </div>

        {/* Stealth info */}
        <div className="mt-4 p-3 bg-privacy/5 border border-privacy/15 rounded-[10px]">
          <div className="flex items-start gap-2">
            <Eye className="w-4 h-4 text-privacy shrink-0 mt-0.5" />
            <p className="text-caption text-gray">
              <strong className="text-privacy">Stealth Mode:</strong> Your position uses ECDH
              key derivation. Only your viewing key can detect it - no need to save claim links.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EarnPage() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const { keys, isLoading: keysLoading, deriveKeys } = useZVaultKeys();
  const { notes } = useStealthInbox();

  // Use SDK yield pool hook (real scanning via ECDH)
  const {
    poolStats,
    positions,
    isScanning,
    isLoading: poolLoading,
    lastScan,
    scanForPositions,
    createDeposit,
  } = useYieldPool(keys);

  // Local state
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [operationStatus, setOperationStatus] = useState<PoolOperationStatus | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Auto-scan when keys become available
  useEffect(() => {
    if (keys && !lastScan) {
      scanForPositions();
    }
  }, [keys, lastScan, scanForPositions]);

  // Close operation status modal
  const closeOperationStatus = () => {
    setIsProcessing(false);
    setOperationStatus(null);
  };

  // Handle deposit using SDK
  const handleDeposit = async (noteIndex: number) => {
    if (!keys) return;

    setIsLoading(true);
    setIsDepositModalOpen(false);
    setIsProcessing(true);
    setOperationStatus({ step: "preparing", message: "Preparing deposit..." });

    try {
      const note = notes[noteIndex];
      if (!note) throw new Error("Note not found");

      // Create stealth meta address for self
      setOperationStatus({ step: "preparing", message: "Creating stealth address...", progress: 20 });
      const meta = createStealthMetaAddress(keys);

      // Create deposit position using real SDK function
      setOperationStatus({ step: "generating_proof", message: "Generating ZK proof...", progress: 30 });
      const position = await createDeposit(meta, BigInt(note.amount));
      console.log("Created position:", position);

      // TODO: Submit to chain when backend ready
      setOperationStatus({ step: "building_tx", message: "Building transaction... (Demo mode)", progress: 60 });
      await new Promise((r) => setTimeout(r, 500)); // Simulate

      setOperationStatus({ step: "complete", message: "Deposit created! (Contract not yet deployed - demo mode)" });
      await scanForPositions();
    } catch (err) {
      console.error("Deposit failed:", err);
      setOperationStatus({
        step: "error",
        message: "Deposit failed",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const availableNotes = notes.map((note, index) => ({
    id: index.toString(),
    amount: BigInt(note.amount),
  }));

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="w-full max-w-[680px] mb-6 flex items-center justify-between">
        <Link
          href="/bridge"
          className="inline-flex items-center gap-2 text-body2 text-gray hover:text-gray-light transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Bridge
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-privacy/10 border border-privacy/20">
            <TrendingUp className="w-3 h-3 text-privacy" />
            <span className="text-caption text-privacy">zkEarn</span>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div
        className={cn(
          "bg-card border border-solid border-gray/30 p-6",
          "w-[680px] max-w-[calc(100vw-32px)] rounded-[20px]"
        )}
      >
        {/* Title */}
        <div className="text-center mb-6">
          <h1 className="text-heading5 text-foreground mb-2">
            zkEarn - Stealth Yield Pool
          </h1>
          <p className="text-body2 text-gray">
            Earn yield privately using stealth addresses - scan with your viewing key
          </p>
        </div>

        {/* Pool Stats */}
        <div className="mb-6">
          <PoolStatsCard stats={poolStats} />
        </div>

        {/* User Section */}
        {!wallet.connected ? (
          <div className="text-center py-8 bg-muted rounded-[16px] border border-gray/20">
            <Wallet className="w-12 h-12 text-gray mx-auto mb-4" />
            <p className="text-body2 text-gray mb-4">
              Connect your wallet to start earning yield privately
            </p>
            <button
              onClick={() => setVisible(true)}
              className={cn(
                "inline-flex items-center gap-2 px-6 py-3 rounded-[10px]",
                "bg-privacy hover:bg-privacy/80 text-background transition-colors"
              )}
            >
              <Wallet className="w-4 h-4" />
              Connect Wallet
            </button>
          </div>
        ) : !keys ? (
          <div className="text-center py-8 bg-muted rounded-[16px] border border-gray/20">
            <Shield className="w-12 h-12 text-privacy mx-auto mb-4" />
            <p className="text-body2 text-gray mb-4">
              Derive your viewing key to scan for yield positions
            </p>
            <button
              onClick={deriveKeys}
              disabled={keysLoading}
              className={cn(
                "inline-flex items-center gap-2 px-6 py-3 rounded-[10px]",
                "bg-privacy hover:bg-privacy/80 text-background",
                "disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              )}
            >
              {keysLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing...
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4" />
                  Derive Viewing Key
                </>
              )}
            </button>
          </div>
        ) : (
          <>
            {/* Your Positions */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-body1-semibold text-foreground">Your Positions</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={scanForPositions}
                    disabled={isScanning}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-[8px]",
                      "bg-gray/20 hover:bg-gray/30 text-gray-light text-caption transition-colors",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    {isScanning ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5" />
                    )}
                    Scan
                  </button>
                  <button
                    onClick={() => setIsDepositModalOpen(true)}
                    disabled={poolStats?.paused}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-[8px]",
                      "bg-privacy hover:bg-privacy/80 text-background text-caption transition-colors",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    <ArrowDownToLine className="w-3.5 h-3.5" />
                    New Deposit
                  </button>
                </div>
              </div>

              {/* Last scan info */}
              {lastScan && (
                <div className="flex items-center gap-1.5 text-caption text-gray mb-3">
                  <Clock className="w-3 h-3" />
                  Last scanned: {formatTimeAgo(lastScan)}
                </div>
              )}

              {isScanning ? (
                <div className="p-6 bg-muted rounded-[16px] border border-gray/20 text-center">
                  <Loader2 className="w-10 h-10 text-privacy mx-auto mb-3 animate-spin" />
                  <p className="text-body2 text-gray mb-2">
                    Scanning with viewing key...
                  </p>
                  <p className="text-caption text-gray">
                    Using ECDH to discover your stealth positions
                  </p>
                </div>
              ) : positions.length === 0 ? (
                <div className="p-6 bg-muted rounded-[16px] border border-gray/20 text-center">
                  <Lock className="w-10 h-10 text-gray mx-auto mb-3" />
                  <p className="text-body2 text-gray mb-3">
                    No positions found
                  </p>
                  <p className="text-caption text-gray">
                    Deposit zkBTC to start earning yield privately
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {positions.map((position, idx) => (
                    <PositionCard
                      key={`${position.poolId}-${position.leafIndex}-${idx}`}
                      position={position}
                      stats={poolStats}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* How it Works */}
            <div className="p-4 bg-muted border border-gray/15 rounded-[12px]">
              <div className="flex items-center gap-2 mb-3">
                <Info className="w-4 h-4 text-privacy" />
                <span className="text-body2-semibold text-foreground">How Stealth zkEarn Works</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-caption">
                <div className="p-3 bg-background/50 rounded-[8px]">
                  <ArrowDownToLine className="w-5 h-5 text-privacy mb-2" />
                  <p className="text-foreground mb-1">1. Stealth Deposit</p>
                  <p className="text-gray">
                    ECDH derives a unique stealth address. Only ephemeral pubkey is on-chain.
                  </p>
                </div>
                <div className="p-3 bg-background/50 rounded-[8px]">
                  <Eye className="w-5 h-5 text-privacy mb-2" />
                  <p className="text-foreground mb-1">2. Viewing Key Scan</p>
                  <p className="text-gray">
                    Your viewing key scans announcements via ECDH - no secrets to save.
                  </p>
                </div>
                <div className="p-3 bg-background/50 rounded-[8px]">
                  <ArrowUpFromLine className="w-5 h-5 text-privacy mb-2" />
                  <p className="text-foreground mb-1">3. Spending Key Claim</p>
                  <p className="text-gray">
                    Spending key derives stealthPriv for ZK proof. Unlinkable withdrawal.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Privacy Notice Footer */}
        <div className="mt-6 flex items-center gap-2 py-2 px-3 bg-privacy/5 border border-privacy/15 rounded-[8px]">
          <EyeOff className="w-4 h-4 text-privacy" />
          <span className="text-caption text-privacy">
            Stealth mode: positions discovered via ECDH - only you can see them
          </span>
        </div>
      </div>

      {/* Deposit Modal */}
      <DepositModal
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
        onDeposit={handleDeposit}
        availableNotes={availableNotes}
        isLoading={isLoading}
      />

      {/* Operation Status Modal */}
      <OperationStatus
        status={operationStatus}
        isOpen={isProcessing}
        onClose={closeOperationStatus}
        title="zkEarn Operation"
      />
    </main>
  );
}
