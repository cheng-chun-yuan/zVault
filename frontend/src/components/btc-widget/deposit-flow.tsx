"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection } from "@solana/web3.js";
import {
  Copy, Check, AlertCircle, AlertTriangle, Key, Eye, EyeOff,
  RefreshCw, QrCode, ExternalLink, Shield, Send, User, Tag, Info,
  Zap, Loader2, CheckCircle2
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/utils";
import { useNoteStorage } from "@/hooks/use-note-storage";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useZVaultKeys } from "@/hooks/use-zvault";
import { notifyDepositConfirmed, notifyDepositDetected, notifyCopied, notifySuccess, notifyError } from "@/lib/notifications";
import {
  createDepositFromSeed,
  serializeNote,
  encodeClaimLink,
  type Note,
  type DepositCredentials,
} from "@/lib/sdk";
import {
  prepareStealthDeposit,
  lookupZkeyName,
  decodeStealthMetaAddress,
  bytesToHex,
  deriveNote,
  createStealthDeposit,
  type StealthMetaAddress,
  type PreparedStealthDeposit,
} from "@zvault/sdk";
import { registerDeposit } from "@/lib/api/deposits";
import { useDepositStatus } from "@/hooks/use-deposit-status";
import { DepositProgress } from "@/components/deposit";
import { Tooltip, TooltipText } from "@/components/ui/tooltip";
import { InlineError } from "@/components/ui/error-display";
import { LoadingState } from "@/components/ui/loading-state";

// Deposit modes
type DepositMode = "note" | "stealth";

// Network: "testnet" for tb1p... addresses, "mainnet" for bc1p... addresses
const BITCOIN_NETWORK: "mainnet" | "testnet" = "testnet";

// Local type for deposit data
interface LocalDepositData {
  commitment: string;
  taproot_address: string;
  expires_at: number;
  note_export: string;
}

// Generate a random secret note
function generateSecretNote(): string {
  const words = [
    "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
    "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
    "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey",
    "xray", "yankee", "zulu", "bitcoin", "satoshi", "privacy", "freedom",
    "stealth", "shield", "secret", "cipher", "crypto", "hash", "block"
  ];
  const randomWords = Array.from({ length: 4 }, () =>
    words[Math.floor(Math.random() * words.length)]
  );
  const randomNum = Math.floor(Math.random() * 10000);
  return `${randomWords.join("-")}-${randomNum}`;
}

export function DepositFlow() {
  const { publicKey, connected } = useWallet();
  const { saveNote } = useNoteStorage();
  const { copied, copy } = useCopyToClipboard();
  const {
    keys,
    stealthAddressEncoded,
    deriveKeys,
    isLoading: keysLoading,
  } = useZVaultKeys();
  const [stealthCopied, setStealthCopied] = useState(false);

  // Demo mode state
  const [demoMode, setDemoMode] = useState(false);
  const [demoAmount, setDemoAmount] = useState("10000");
  const [demoSubmitting, setDemoSubmitting] = useState(false);
  const [demoResult, setDemoResult] = useState<{
    signature: string;
    secret?: string;
    ephemeralPubKey?: string;
  } | null>(null);

  const copyStealthAddress = async () => {
    if (!stealthAddressEncoded) return;
    await navigator.clipboard.writeText(stealthAddressEncoded);
    setStealthCopied(true);
    notifyCopied("Stealth address");
    setTimeout(() => setStealthCopied(false), 2000);
  };

  // Mode state
  const [mode, setMode] = useState<DepositMode>("note");

  // Note mode state
  const [secretNote, setSecretNote] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [depositData, setDepositData] = useState<LocalDepositData | null>(null);
  const [depositNote, setDepositNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [claimLink, setClaimLink] = useState<string | null>(null);
  const [claimLinkCopied, setClaimLinkCopied] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const [trackerId, setTrackerId] = useState<string | null>(null);

  // Stealth mode state
  const [recipient, setRecipient] = useState("");
  const [recipientType, setRecipientType] = useState<"zkey" | "address">("zkey");
  const [resolvedMeta, setResolvedMeta] = useState<StealthMetaAddress | null>(null);
  const [stealthDeposit, setStealthDeposit] = useState<PreparedStealthDeposit | null>(null);
  const [resolvingRecipient, setResolvingRecipient] = useState(false);

  // Backend deposit tracker hook
  const trackerStatus = useDepositStatus(trackerId, {
    onStatusChange: (status, prevStatus) => {
      console.log("[Tracker] Status changed:", prevStatus, "→", status);
      // Show notification when deposit is detected and confirming
      if (status === "confirming" && prevStatus === "detected") {
        notifyDepositDetected(1, 6);
      }
    },
    onClaimable: () => {
      console.log("[Tracker] Deposit is now claimable!");
      // Show toast notification with claim link
      notifyDepositConfirmed(claimLink || undefined);
    },
    onError: (err) => {
      console.error("[Tracker] Error:", err);
    },
  });

  // Generate claim link from seed (much simpler than nullifier+secret!)
  useEffect(() => {
    if (secretNote.trim().length >= 8) {
      // Just use the seed directly - claim page derives the note from it
      const encoded = encodeClaimLink(secretNote.trim());
      setClaimLink(encoded);
    }
  }, [secretNote]);

  // Generate deposit data when secret is valid (8+ characters)
  useEffect(() => {
    if (secretNote.trim().length >= 8 && !depositData && !loading) {
      generateDepositData();
    }
  }, [secretNote]);

  // Backend tracker status
  const hasBackendTracker = trackerId && (trackerStatus.isConnected || trackerStatus.status);

  const generateDepositData = async () => {
    if (secretNote.trim().length < 8) {
      setError("Secret note must be at least 8 characters");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use seed-based deposit - derives note from user's secret phrase
      // This creates a SHORT claim link (just the seed itself)!
      const credentials: DepositCredentials = await createDepositFromSeed(
        secretNote.trim(),
        "testnet",
        typeof window !== "undefined" ? window.location.origin : undefined
      );

      const { note, taprootAddress, claimLink: generatedClaimLink } = credentials;
      setDepositNote(note);

      // Commitment as hex string (handle case where commitment might be undefined)
      const commitment = note.commitment ?? 0n;
      const commitmentHex = commitment.toString(16).padStart(64, "0");
      console.log("[Deposit] Note derived from seed:", {
        commitment: commitmentHex.slice(0, 16) + "...",
        address: taprootAddress,
        claimLinkLength: generatedClaimLink.length,
      });

      const expiresAt = Math.floor(Date.now() / 1000) + 86400; // 24 hours

      const response: LocalDepositData = {
        commitment: commitmentHex,
        taproot_address: taprootAddress,
        note_export: generatedClaimLink,
        expires_at: expiresAt,
      };

      setDepositData(response);

      // Save note for later retrieval
      saveNote({
        commitment: response.commitment,
        noteExport: response.note_export,
        amountSats: 0, // Will be determined by actual deposit
        taprootAddress: response.taproot_address,
        expiresAt: response.expires_at,
        secretNote: secretNote,
        poseidonCommitment: commitmentHex,
        poseidonNote: serializeNote(note),
      });

      // Register with backend tracker
      try {
        console.log("[Deposit] Registering with backend tracker...");
        const registerResult = await registerDeposit(
          taprootAddress,
          commitmentHex,
          0, // Amount unknown until deposit
          generatedClaimLink
        );
        if (registerResult.success && registerResult.deposit_id) {
          setTrackerId(registerResult.deposit_id);
          console.log("[Deposit] Registered with tracker, ID:", registerResult.deposit_id);
        }
      } catch (trackerErr) {
        console.warn("[Deposit] Failed to register with tracker:", trackerErr);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to prepare deposit");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateSecret = useCallback(() => {
    setSecretNote(generateSecretNote());
    // Reset deposit data when generating new secret
    setDepositData(null);
    setDepositNote(null);
    setClaimLink(null);
    setTrackerId(null);
    setError(null);
  }, []);

  const copyAddress = async () => {
    if (!depositData) return;
    await navigator.clipboard.writeText(depositData.taproot_address);
    setAddressCopied(true);
    notifyCopied("Deposit address");
    setTimeout(() => setAddressCopied(false), 2000);
  };

  const copyClaimLink = async () => {
    if (!claimLink) return;
    const fullUrl = `${window.location.origin}/claim?note=${claimLink}`;
    await navigator.clipboard.writeText(fullUrl);
    setClaimLinkCopied(true);
    notifyCopied("Claim link");
    setTimeout(() => setClaimLinkCopied(false), 2000);
  };

  const resetFlow = () => {
    // Note mode reset
    setSecretNote("");
    setShowSecret(false);
    setShowQR(false);
    setDepositData(null);
    setDepositNote(null);
    setError(null);
    setLoading(false);
    setClaimLink(null);
    setClaimLinkCopied(false);
    setAddressCopied(false);
    setTrackerId(null);
    // Stealth mode reset
    setRecipient("");
    setResolvedMeta(null);
    setStealthDeposit(null);
    // Demo mode reset
    setDemoAmount("10000");
    setDemoResult(null);
  };

  // Demo mode: Submit mock deposit via backend relayer (keeps user anonymous)
  const submitDemoDeposit = async () => {
    if (mode === "note" && secretNote.trim().length < 8) {
      notifyError("Please enter or generate a secret (8+ chars)");
      return;
    }

    if (mode === "stealth" && !resolvedMeta) {
      notifyError("Please resolve recipient first");
      return;
    }

    const amount = BigInt(demoAmount || "10000");
    if (amount <= 0n) {
      notifyError("Amount must be positive");
      return;
    }

    setDemoSubmitting(true);
    setDemoResult(null);
    setError(null);

    try {
      if (mode === "note") {
        // Derive note from secret (index 0)
        const note = deriveNote(secretNote.trim(), 0, amount);

        // Call API - relayer submits transaction (keeps user anonymous)
        const response = await fetch("/api/demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "note",
            secret: bytesToHex(note.secretBytes),
          }),
        });

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || "Failed to submit demo deposit");
        }

        setDemoResult({
          signature: result.signature,
          secret: secretNote.trim(),
        });

        notifySuccess("Mock deposit added on-chain!");
      } else {
        // Stealth mode
        if (!resolvedMeta) {
          notifyError("Please resolve recipient first");
          setDemoSubmitting(false);
          return;
        }

        // Create stealth deposit (single ephemeral key pattern)
        const stealthDepositData = await createStealthDeposit(resolvedMeta, amount);

        // Call API - relayer submits transaction (keeps user anonymous)
        const response = await fetch("/api/demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "stealth",
            ephemeralPub: bytesToHex(stealthDepositData.ephemeralPub),
            commitment: bytesToHex(stealthDepositData.commitment),
            amountSats: amount.toString(),
          }),
        });

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || "Failed to submit demo stealth deposit");
        }

        setDemoResult({
          signature: result.signature,
          ephemeralPubKey: bytesToHex(stealthDepositData.ephemeralPub),
        });

        notifySuccess("Mock stealth deposit added on-chain!");
      }
    } catch (err) {
      console.error("Demo deposit error:", err);
      setError(err instanceof Error ? err.message : "Failed to submit demo deposit");
    } finally {
      setDemoSubmitting(false);
    }
  };

  // Resolve recipient (zkey name or stealth address - auto-detect)
  const resolveRecipient = async () => {
    if (!recipient.trim()) {
      setError("Please enter a recipient");
      return;
    }

    setResolvingRecipient(true);
    setError(null);
    setResolvedMeta(null);

    const trimmed = recipient.trim();

    try {
      // Auto-detect: if it looks like hex (long, only hex chars), try as address first
      // Otherwise try as zkey name
      const isLikelyHex = /^[0-9a-fA-F]{100,}$/.test(trimmed);

      if (recipientType === "zkey" || (!isLikelyHex && recipientType === "address")) {
        // Lookup .zkey name on-chain
        // Remove .zkey suffix if user included it
        const name = trimmed.replace(/\.zkey$/i, "");
        const connection = new Connection(
          process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com"
        );
        // Wrap connection to match SDK expected type
        const connectionAdapter = {
          getAccountInfo: async (pubkey: { toBytes(): Uint8Array }) => {
            const { PublicKey } = await import("@solana/web3.js");
            const pk = new PublicKey(pubkey.toBytes());
            const info = await connection.getAccountInfo(pk);
            return info ? { data: new Uint8Array(info.data) } : null;
          },
        };
        const result = await lookupZkeyName(connectionAdapter, name);
        if (!result) {
          // If in address mode, also try as hex
          if (recipientType === "address") {
            const meta = decodeStealthMetaAddress(trimmed);
            if (meta) {
              setResolvedMeta(meta);
              return;
            }
          }
          setError(`Name "${name}.zkey" not found`);
          return;
        }
        // Convert to StealthMetaAddress format
        const meta: StealthMetaAddress = {
          spendingPubKey: result.spendingPubKey,
          viewingPubKey: result.viewingPubKey,
        };
        setResolvedMeta(meta);
      } else {
        // Parse raw stealth address (hex encoded)
        // Try to decode as hex stealth meta-address
        const meta = decodeStealthMetaAddress(trimmed);
        if (!meta) {
          setError("Invalid stealth address format. Expected 130 hex characters (65 bytes).");
          return;
        }
        setResolvedMeta(meta);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve recipient");
    } finally {
      setResolvingRecipient(false);
    }
  };

  // Generate stealth deposit (amount-independent - address works for any amount)
  const generateStealthDeposit = async () => {
    if (!resolvedMeta) {
      setError("Please resolve recipient first");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const prepared = await prepareStealthDeposit({
        recipientMeta: resolvedMeta,
        network: BITCOIN_NETWORK,
      });

      setStealthDeposit(prepared);
      console.log("[Stealth Deposit] Prepared:", {
        address: prepared.btcDepositAddress,
        opReturnSize: prepared.opReturnData.length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to prepare stealth deposit");
    } finally {
      setLoading(false);
    }
  };

  // Determine deposit status for display
  const getStatusDisplay = () => {
    if (trackerStatus.status) {
      const statusMap: Record<string, { label: string; color: string }> = {
        pending: { label: "Waiting for deposit...", color: "text-gray" },
        detected: { label: "Deposit detected!", color: "text-btc" },
        confirming: { label: `Confirming (${trackerStatus.confirmations} conf)`, color: "text-btc" },
        confirmed: { label: "Deposit confirmed!", color: "text-success" },
        ready: { label: "Ready to claim!", color: "text-privacy" },
        claimed: { label: "Already claimed", color: "text-success" },
      };
      return statusMap[trackerStatus.status] || { label: trackerStatus.status, color: "text-gray" };
    }
    return { label: "Waiting for deposit...", color: "text-gray" };
  };

  const isSecretValid = secretNote.trim().length >= 8;

  return (
    <div className="flex flex-col">
      {/* Demo Mode Toggle */}
      <div className="flex items-center justify-between mb-4 p-3 bg-warning/5 border border-warning/20 rounded-[12px]">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-warning" />
          <span className="text-body2 text-warning">Demo Mode</span>
          <Tooltip content="Skip BTC deposit - add mock commitment directly to Solana for testing">
            <Info className="w-3.5 h-3.5 text-warning/60" />
          </Tooltip>
        </div>
        <button
          onClick={() => { setDemoMode(!demoMode); setDemoResult(null); }}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors",
            demoMode ? "bg-warning" : "bg-gray/30"
          )}
          role="switch"
          aria-checked={demoMode}
        >
          <span
            className={cn(
              "absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform",
              demoMode && "translate-x-5"
            )}
          />
        </button>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2 mb-4 p-1 bg-muted rounded-[10px] border border-gray/15" role="tablist" aria-label="Deposit mode">
        <button
          role="tab"
          aria-selected={mode === "note"}
          aria-controls="note-panel"
          onClick={() => { setMode("note"); resetFlow(); }}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[8px] text-body2 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-privacy focus-visible:ring-offset-1",
            mode === "note"
              ? "bg-privacy/12 text-privacy border border-privacy/25"
              : "text-gray hover:text-gray-light"
          )}
        >
          <User className="w-4 h-4" />
          Self (Note)
        </button>
        <button
          role="tab"
          aria-selected={mode === "stealth"}
          aria-controls="stealth-panel"
          onClick={() => { setMode("stealth"); resetFlow(); }}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[8px] text-body2 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sol focus-visible:ring-offset-1",
            mode === "stealth"
              ? "bg-sol/12 text-sol border border-sol/25"
              : "text-gray hover:text-gray-light"
          )}
        >
          <Send className="w-4 h-4" />
          Send to Address
        </button>
      </div>

      {/* Stealth Address Section - for receiving from others (only in note mode) */}
      {mode === "note" && (
        <div className="mb-4 p-3 bg-privacy/5 border border-privacy/15 rounded-[12px]">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-privacy" />
            <span className="text-caption text-privacy">
              Your{" "}
              <TooltipText
                text="Stealth Address"
                tooltip="A one-time address that hides your identity. Only you can scan and claim funds sent to it."
                className="text-privacy"
              />
            </span>
          </div>
          {!keys ? (
            <div className="flex items-center justify-between">
              <span className="text-caption text-gray">
                Sign to derive your private address
              </span>
              <button
                onClick={deriveKeys}
                disabled={keysLoading}
                className="px-3 py-1 text-caption bg-privacy/15 hover:bg-privacy/20 text-privacy rounded-[6px] transition-colors disabled:opacity-50"
              >
                {keysLoading ? "..." : "Derive"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-caption font-mono text-gray-light truncate">
                {stealthAddressEncoded?.slice(0, 20)}...{stealthAddressEncoded?.slice(-20)}
              </code>
              <button
                onClick={copyStealthAddress}
                className="p-1.5 rounded-[6px] bg-privacy/10 hover:bg-privacy/20 transition-colors"
                title="Copy to share with others"
              >
                {stealthCopied ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-privacy" />
                )}
              </button>
            </div>
          )}
          <p className="text-caption text-gray mt-1">
            Share this to receive private payments from others
          </p>
        </div>
      )}

      {/* ========== STEALTH MODE ========== */}
      {mode === "stealth" && (
        <>
          {/* Recipient Type Toggle */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => { setRecipientType("zkey"); setRecipient(""); setResolvedMeta(null); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[8px] text-caption transition-colors",
                recipientType === "zkey"
                  ? "bg-sol/12 text-sol border border-sol/25"
                  : "bg-muted text-gray border border-gray/15 hover:text-gray-light"
              )}
            >
              <Tag className="w-3.5 h-3.5" />
              .zkey Name
              <Tooltip content="A human-readable name (like alice.zkey) that maps to a stealth address on Solana.">
                <Info className="w-3 h-3 opacity-60" />
              </Tooltip>
            </button>
            <button
              onClick={() => { setRecipientType("address"); setRecipient(""); setResolvedMeta(null); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[8px] text-caption transition-colors",
                recipientType === "address"
                  ? "bg-sol/12 text-sol border border-sol/25"
                  : "bg-muted text-gray border border-gray/15 hover:text-gray-light"
              )}
            >
              <Key className="w-3.5 h-3.5" />
              Stealth Address
            </button>
          </div>

          {/* Recipient Input */}
          <div className="mb-4">
            <label className="text-body2 text-gray-light pl-2 mb-2 block">
              {recipientType === "zkey" ? "Recipient .zkey Name" : "Recipient Stealth Address"}
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => { setRecipient(e.target.value); setResolvedMeta(null); setStealthDeposit(null); }}
                  placeholder={recipientType === "zkey" ? "alice" : "alice.zkey or 130 hex chars"}
                  className={cn(
                    "w-full p-3 bg-muted border border-gray/15 rounded-[12px]",
                    "text-body2 font-mono text-foreground placeholder:text-gray",
                    "outline-none focus:border-sol/40 transition-colors",
                    recipientType === "zkey" ? "pr-16" : ""
                  )}
                />
                {recipientType === "zkey" && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-body2 text-gray">.zkey</span>
                )}
              </div>
              <button
                onClick={resolveRecipient}
                disabled={!recipient.trim() || resolvingRecipient}
                className={cn(
                  "px-4 py-2 rounded-[10px] text-body2 transition-colors",
                  "bg-sol hover:bg-sol-dark text-white",
                  "disabled:bg-gray/20 disabled:text-gray disabled:cursor-not-allowed"
                )}
              >
                {resolvingRecipient ? "..." : "Resolve"}
              </button>
            </div>
          </div>

          {/* Not found error */}
          {error && !resolvedMeta && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-[12px]">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <span className="text-body2 text-red-400">{error}</span>
              </div>
            </div>
          )}

          {/* Resolved recipient info */}
          {resolvedMeta && (
            <div className="mb-4 p-3 bg-sol/5 border border-sol/15 rounded-[12px]">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-success" />
                <span className="text-body2-semibold text-success">Recipient Found</span>
              </div>
            </div>
          )}

          {/* ========== DEMO MODE: Stealth Deposit ========== */}
          {demoMode && resolvedMeta && (
            <>
              {/* Amount Input */}
              <div className="mb-4">
                <label className="text-body2 text-gray-light pl-2 mb-2 block">Amount (satoshis)</label>
                <input
                  type="number"
                  value={demoAmount}
                  onChange={(e) => setDemoAmount(e.target.value)}
                  placeholder="10000"
                  className={cn(
                    "w-full p-3 bg-muted border border-gray/15 rounded-[12px]",
                    "text-body2 font-mono text-foreground placeholder:text-gray",
                    "outline-none focus:border-warning/40 transition-colors"
                  )}
                />
                <p className="text-caption text-gray mt-1 pl-2">
                  {demoAmount ? `${(parseInt(demoAmount) / 100_000_000).toFixed(8)} BTC` : ""}
                </p>
              </div>

              {/* Demo Submit Button */}
              <button
                onClick={submitDemoDeposit}
                disabled={demoSubmitting}
                className={cn(
                  "w-full py-3 rounded-[12px] font-medium transition-colors flex items-center justify-center gap-2 mb-4",
                  "bg-warning hover:bg-warning/90 text-background",
                  "disabled:bg-gray/20 disabled:text-gray disabled:cursor-not-allowed"
                )}
              >
                {demoSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Publishing via relayer...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Add Mock Stealth Deposit
                  </>
                )}
              </button>

              {/* Demo Result */}
              {demoResult && (
                <div className="p-4 bg-success/10 border border-success/30 rounded-[12px] mb-4">
                  <div className="flex items-center gap-2 text-success mb-2">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="text-body2-semibold">Mock Stealth Deposit Published!</span>
                  </div>

                  {demoResult.ephemeralPubKey && (
                    <div className="mb-3">
                      <p className="text-caption text-gray mb-1">Ephemeral Public Key:</p>
                      <code className="block text-[10px] font-mono text-sol bg-muted p-2 rounded-[8px] break-all">
                        {demoResult.ephemeralPubKey}
                      </code>
                    </div>
                  )}

                  <a
                    href={`https://solscan.io/tx/${demoResult.signature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-caption text-sol hover:text-sol-light transition-colors"
                  >
                    View transaction
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              {/* Info about stealth deposit */}
              <div className="p-3 bg-sol/10 border border-sol/20 rounded-[12px] mb-4">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-sol shrink-0 mt-0.5" />
                  <p className="text-caption text-gray">
                    The recipient can scan for this deposit using their stealth keys. Only they can see and claim it.
                  </p>
                </div>
              </div>

              {/* Reset button */}
              {demoResult && (
                <button onClick={resetFlow} className="btn-secondary w-full">
                  <RefreshCw className="w-4 h-4" />
                  Start New Deposit
                </button>
              )}
            </>
          )}

          {/* ========== NORMAL MODE: Generate Stealth Deposit ========== */}
          {/* Generate Stealth Deposit Button - amount is determined by actual BTC sent */}
          {!demoMode && resolvedMeta && !stealthDeposit && (
            <button
              onClick={generateStealthDeposit}
              disabled={loading}
              className={cn(
                "btn-primary w-full mb-4",
                "disabled:bg-gray/20 disabled:text-gray disabled:cursor-not-allowed"
              )}
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Generate Deposit Address
                </>
              )}
            </button>
          )}

          {/* Stealth Deposit Result (Normal Mode) */}
          {!demoMode && stealthDeposit && (
            <>
              {/* Deposit Address */}
              <div className="gradient-bg-bitcoin p-4 rounded-[12px] mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-caption text-gray">Send BTC to this address</p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowQR(!showQR)}
                      className={cn(
                        "p-1.5 rounded-[6px] transition-colors",
                        showQR ? "bg-btc/20 text-btc" : "bg-btc/10 text-btc hover:bg-btc/20"
                      )}
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { navigator.clipboard.writeText(stealthDeposit.btcDepositAddress); setAddressCopied(true); notifyCopied("Deposit address"); setTimeout(() => setAddressCopied(false), 2000); }}
                      className="p-1.5 rounded-[6px] bg-btc/10 hover:bg-btc/20 transition-colors"
                    >
                      {addressCopied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4 text-btc" />}
                    </button>
                  </div>
                </div>
                <code className="text-body2 font-mono text-btc break-all block">
                  {stealthDeposit.btcDepositAddress}
                </code>
              </div>

              {/* QR Code */}
              {showQR && (
                <div
                  className="flex justify-center p-4 rounded-[12px] mb-4"
                  role="img"
                  aria-label={`QR code for stealth deposit address ${stealthDeposit.btcDepositAddress}`}
                >
                  <button
                    onClick={() => { navigator.clipboard.writeText(stealthDeposit.btcDepositAddress); setAddressCopied(true); notifyCopied("Deposit address"); setTimeout(() => setAddressCopied(false), 2000); }}
                    className="relative group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-btc focus-visible:ring-offset-2 rounded-lg"
                    aria-label="Click to copy deposit address"
                  >
                    <QRCodeSVG
                      value={stealthDeposit.btcDepositAddress}
                      size={180}
                      level="M"
                      bgColor="transparent"
                      fgColor="#F7931A"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                      <span className="text-white text-caption font-medium">
                        {addressCopied ? "Copied!" : "Tap to copy address"}
                      </span>
                    </div>
                  </button>
                </div>
              )}

              {/* Info */}
              <div className="gradient-bg-card p-4 rounded-[12px] mb-4 border border-sol/20">
                <p className="text-caption text-gray">
                  Send any amount of BTC to this address. Recipient will be able to scan and claim.
                </p>
              </div>

              {/* Important Note */}
              <div className="p-3 bg-btc/10 border border-btc/20 rounded-[12px] mb-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-btc shrink-0 mt-0.5" />
                  <div>
                    <p className="text-caption text-btc font-medium">Important</p>
                    <p className="text-caption text-gray">
                      The recipient must scan for this deposit using their stealth keys.
                      Only they can see and claim this deposit.
                    </p>
                  </div>
                </div>
              </div>

              {/* View on explorer */}
              <a
                href={`https://mempool.space/testnet/address/${stealthDeposit.btcDepositAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-tertiary w-full mb-3 justify-center"
              >
                View on Mempool
                <ExternalLink className="w-4 h-4" />
              </a>

              {/* Reset button */}
              <button onClick={resetFlow} className="btn-secondary w-full">
                <RefreshCw className="w-4 h-4" />
                Start New Deposit
              </button>
            </>
          )}
        </>
      )}

      {/* ========== NOTE MODE ========== */}
      {mode === "note" && (
        <>
      {/* Progress Stepper */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          {[
            { label: "Enter Secret", step: 1 },
            { label: "Send BTC", step: 2 },
            { label: "Save Claim", step: 3 },
            { label: "Complete", step: 4 },
          ].map((item, index) => {
            // Calculate current step
            const currentStep = !isSecretValid ? 1 :
              !depositData ? 1 :
              trackerStatus.status === "confirmed" || trackerStatus.status === "ready" || trackerStatus.status === "claimed" ? 4 :
              trackerStatus.status === "confirming" || trackerStatus.status === "detected" ? 3 : 2;

            const isActive = item.step === currentStep;
            const isCompleted = item.step < currentStep;
            const isFirst = index === 0;
            const isLast = index === 3;

            return (
              <div key={item.step} className="flex flex-col items-center flex-1">
                <div className="flex items-center w-full">
                  {/* Line before circle (or invisible spacer for first item) */}
                  <div
                    className={cn(
                      "flex-1 h-0.5 transition-colors",
                      isFirst ? "bg-transparent" :
                      isCompleted || isActive ? "bg-privacy" : "bg-gray/30"
                    )}
                  />
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-caption font-medium transition-colors shrink-0",
                      isCompleted ? "bg-privacy text-background" :
                      isActive ? "bg-privacy/20 text-privacy border-2 border-privacy" :
                      "bg-gray/20 text-gray border border-gray/30"
                    )}
                  >
                    {isCompleted ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      item.step
                    )}
                  </div>
                  {/* Line after circle (or invisible spacer for last item) */}
                  <div
                    className={cn(
                      "flex-1 h-0.5 transition-colors",
                      isLast ? "bg-transparent" :
                      isCompleted ? "bg-privacy" : "bg-gray/30"
                    )}
                  />
                </div>
                <span
                  className={cn(
                    "text-[10px] mt-1.5 text-center transition-colors",
                    isActive ? "text-privacy font-medium" :
                    isCompleted ? "text-privacy/70" :
                    "text-gray"
                  )}
                >
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Secret note input */}
      <div className="mb-4">
        <label className="text-body2 text-gray-light pl-2 mb-2 flex items-center gap-1.5">
          <TooltipText
            text="Secret Note"
            tooltip="A private passphrase that proves ownership of your deposit. Anyone with this secret can claim the funds."
            className="text-gray-light"
          />
        </label>
        <div className="relative">
          <input
            type={showSecret ? "text" : "password"}
            value={secretNote}
            onChange={(e) => {
              setSecretNote(e.target.value);
              // Reset deposit data when secret changes
              if (depositData) {
                setDepositData(null);
                setDepositNote(null);
                setClaimLink(null);
                setTrackerId(null);
              }
            }}
            placeholder="Enter or generate a secret note (8+ chars)"
            aria-label="Secret note for deposit"
            aria-describedby="secret-note-help"
            className={cn(
              "w-full p-3 pr-24 bg-muted border border-gray/15 rounded-[12px]",
              "text-body2 font-mono text-foreground placeholder:text-gray",
              "outline-none focus:border-privacy/40 transition-colors",
              "focus-visible:ring-2 focus-visible:ring-privacy/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            )}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="p-2 text-gray hover:text-gray-light transition-colors"
              title={showSecret ? "Hide secret" : "Show secret"}
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={handleGenerateSecret}
              className="p-2 text-privacy hover:text-success transition-colors"
              title="Generate random secret"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
        <p id="secret-note-help" className="text-caption text-gray mt-1 pl-2">
          {isSecretValid ? "Your secret is valid. Address generated below." : "Enter at least 8 characters to generate deposit address."}
        </p>
      </div>

      {/* Loading state */}
      {loading && !demoMode && (
        <LoadingState message="Generating deposit address..." className="py-4" />
      )}

      {/* Error */}
      {error && (
        <InlineError error={error} className="mb-4" />
      )}

      {/* ========== DEMO MODE: Note Deposit ========== */}
      {demoMode && isSecretValid && (
        <>
          {/* Fixed Amount Display (demo note always uses 10000 sats) */}
          <div className="mb-4">
            <label className="text-body2 text-gray-light pl-2 mb-2 block">Amount (satoshis)</label>
            <div
              className={cn(
                "w-full p-3 bg-muted/50 border border-gray/15 rounded-[12px]",
                "text-body2 font-mono text-gray-light",
                "flex items-center justify-between"
              )}
            >
              <span>10000</span>
              <span className="text-caption text-gray">(fixed for demo)</span>
            </div>
            <p className="text-caption text-gray mt-1 pl-2">
              0.00010000 BTC
            </p>
          </div>

          {/* Demo Submit Button */}
          <button
            onClick={submitDemoDeposit}
            disabled={demoSubmitting || secretNote.length < 8}
            className={cn(
              "w-full py-3 rounded-[12px] font-medium transition-colors flex items-center justify-center gap-2",
              "bg-warning hover:bg-warning/90 text-background",
              "disabled:bg-gray/20 disabled:text-gray disabled:cursor-not-allowed"
            )}
          >
            {demoSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Publishing via relayer...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Add Mock Deposit
              </>
            )}
          </button>

          {/* Demo Result */}
          {demoResult && (
            <div className="mt-4 p-4 bg-success/10 border border-success/30 rounded-[12px]">
              <div className="flex items-center gap-2 text-success mb-2">
                <CheckCircle2 className="w-5 h-5" />
                <span className="text-body2-semibold">Mock Deposit Published!</span>
              </div>

              {demoResult.secret && (
                <div className="mb-3">
                  <p className="text-caption text-gray mb-1">Secret (use to claim):</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-caption font-mono text-privacy bg-muted p-2 rounded-[8px] truncate">
                      {demoResult.secret}
                    </code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(demoResult.secret!); notifyCopied("Secret"); }}
                      className="p-2 bg-muted hover:bg-gray/20 rounded-[8px] transition-colors"
                    >
                      <Copy className="w-4 h-4 text-gray" />
                    </button>
                  </div>
                </div>
              )}

              <a
                href={`https://solscan.io/tx/${demoResult.signature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-caption text-sol hover:text-sol-light transition-colors"
              >
                View transaction
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {/* Reset button */}
          {demoResult && (
            <button onClick={resetFlow} className="btn-secondary w-full mt-3">
              <RefreshCw className="w-4 h-4" />
              Start New Deposit
            </button>
          )}
        </>
      )}

      {/* ========== NORMAL MODE: BTC Deposit ========== */}
      {/* Deposit Data Section - shown when depositData exists and NOT in demo mode */}
      {!demoMode && depositData && (
        <>
          {/* Deposit Address */}
          <div className="gradient-bg-bitcoin p-4 rounded-[12px] mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-caption text-gray">Deposit Address</p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowQR(!showQR)}
                  className={cn(
                    "p-1.5 rounded-[6px] transition-colors",
                    showQR ? "bg-btc/20 text-btc" : "bg-btc/10 text-btc hover:bg-btc/20"
                  )}
                  title={showQR ? "Hide QR code" : "Show QR code"}
                >
                  <QrCode className="w-4 h-4" />
                </button>
                <button
                  onClick={copyAddress}
                  className="p-1.5 rounded-[6px] bg-btc/10 hover:bg-btc/20 transition-colors"
                  title="Copy address"
                >
                  {addressCopied ? (
                    <Check className="w-4 h-4 text-success" />
                  ) : (
                    <Copy className="w-4 h-4 text-btc" />
                  )}
                </button>
              </div>
            </div>
            <code className="text-body2 font-mono text-btc break-all block">
              {depositData.taproot_address}
            </code>
          </div>

          {/* QR Code - toggleable */}
          {showQR && (
            <div
              className="flex justify-center p-4 rounded-[12px] mb-4"
              role="img"
              aria-label={`QR code for Bitcoin deposit address ${depositData.taproot_address}`}
            >
              <button
                onClick={copyAddress}
                className="relative group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-btc focus-visible:ring-offset-2 rounded-lg"
                aria-label="Click to copy deposit address"
              >
                <QRCodeSVG
                  value={depositData.taproot_address}
                  size={180}
                  level="M"
                  bgColor="transparent"
                  fgColor="#F7931A"
                />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                  <span className="text-white text-caption font-medium">
                    {addressCopied ? "Copied!" : "Tap to copy address"}
                  </span>
                </div>
              </button>
            </div>
          )}

          {/* Security Warning */}
          <div className="p-3 bg-warning/10 border border-warning/30 rounded-[12px] mb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="text-body2-semibold text-warning mb-1">
                  Keep this secret safe!
                </p>
                <p className="text-caption text-gray">
                  Anyone with this secret can claim your deposit. Save it securely and never share it.
                </p>
              </div>
            </div>
          </div>

          {/* Claim Link */}
          {/* Secret = Claim Link (simplified!) */}
          <div className="gradient-bg-card p-4 rounded-[12px] mb-4 border border-privacy/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-privacy" />
                <span className="text-caption text-privacy">Your Secret (Save This!)</span>
              </div>
              <button
                onClick={() => { copy(secretNote); notifyCopied("Secret note"); }}
                className="p-1.5 rounded-[6px] bg-privacy/10 hover:bg-privacy/20 transition-colors"
                title="Copy secret"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-privacy" />
                )}
              </button>
            </div>
            <code className="text-body2 font-mono text-foreground block mb-2">
              {showSecret ? secretNote : "••••••••••••••••"}
            </code>
            <p className="text-caption text-gray">
              This secret is your claim link. Remember it or save it to claim your zBTC later.
            </p>
          </div>

          {/* Deposit Status */}
          <div className="gradient-bg-card p-4 rounded-[12px] mb-4">
            <div className="flex items-center justify-between">
              <span className="text-body2 text-gray-light">Status</span>
              <span className={cn("text-body2-semibold", getStatusDisplay().color)}>
                {getStatusDisplay().label}
              </span>
            </div>

            {/* Backend Tracker Progress */}
            {trackerId && trackerStatus.status && !["pending"].includes(trackerStatus.status) && (
              <div className="mt-3 pt-3 border-t border-gray/15">
                <DepositProgress
                  status={trackerStatus.status}
                  confirmations={trackerStatus.confirmations}
                  sweepConfirmations={trackerStatus.sweepConfirmations}
                />
              </div>
            )}
          </div>

          {/* Testnet faucet link */}
          <div className="flex items-center justify-between p-3 bg-muted border border-gray/15 rounded-[12px] mb-4">
            <span className="text-caption text-gray">Need testnet BTC?</span>
            <a
              href="https://coinfaucet.eu/en/btc-testnet/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-caption text-btc hover:text-btc-light transition-colors flex items-center gap-1"
            >
              Get from faucet
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* View on explorer */}
          <a
            href={`https://mempool.space/testnet/address/${depositData.taproot_address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-tertiary w-full mb-3 justify-center"
          >
            View on Mempool
            <ExternalLink className="w-4 h-4" />
          </a>

          {/* Reset button */}
          <button onClick={resetFlow} className="btn-secondary w-full">
            <RefreshCw className="w-4 h-4" />
            Start New Deposit
          </button>
        </>
      )}

      {/* Generate button - shown when no secret */}
      {!secretNote && !loading && (
        <button
          onClick={handleGenerateSecret}
          className="btn-primary w-full"
        >
          <RefreshCw className="w-4 h-4" />
          Generate Random Secret
        </button>
      )}
        </>
      )}
    </div>
  );
}
