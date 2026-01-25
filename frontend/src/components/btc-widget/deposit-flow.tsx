"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection } from "@solana/web3.js";
import {
  Copy, Check, AlertCircle, Key, Eye, EyeOff,
  RefreshCw, QrCode, ExternalLink, Shield, Send, User, Tag
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/utils";
import { useNoteStorage } from "@/hooks/use-note-storage";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useZVaultKeys } from "@/hooks/use-zvault-keys";
import { notifyDepositConfirmed, notifyDepositDetected } from "@/lib/notifications";
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
  type StealthMetaAddress,
  type PreparedStealthDeposit,
} from "@zvault/sdk";
import { registerDeposit } from "@/lib/api/deposits";
import { useDepositStatus } from "@/hooks/use-deposit-status";
import { DepositProgress } from "@/components/deposit";

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

  const copyStealthAddress = async () => {
    if (!stealthAddressEncoded) return;
    await navigator.clipboard.writeText(stealthAddressEncoded);
    setStealthCopied(true);
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
  const [amountSats, setAmountSats] = useState("");

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
    setTimeout(() => setAddressCopied(false), 2000);
  };

  const copyClaimLink = async () => {
    if (!claimLink) return;
    const fullUrl = `${window.location.origin}/claim?note=${claimLink}`;
    await navigator.clipboard.writeText(fullUrl);
    setClaimLinkCopied(true);
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
    setAmountSats("");
  };

  // Resolve recipient (zkey name or stealth address)
  const resolveRecipient = async () => {
    if (!recipient.trim()) {
      setError("Please enter a recipient");
      return;
    }

    setResolvingRecipient(true);
    setError(null);
    setResolvedMeta(null);

    try {
      if (recipientType === "zkey") {
        // Lookup .zkey name on-chain
        const connection = new Connection(
          process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com"
        );
        const result = await lookupZkeyName(connection, recipient.trim());
        if (!result) {
          setError(`Name "${recipient.trim()}.zkey" not found`);
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
        const trimmed = recipient.trim();
        // Try to decode as hex stealth meta-address
        const meta = decodeStealthMetaAddress(trimmed);
        if (!meta) {
          setError("Invalid stealth address format. Expected 132 hex characters (66 bytes).");
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

  // Generate stealth deposit
  const generateStealthDeposit = async () => {
    if (!resolvedMeta) {
      setError("Please resolve recipient first");
      return;
    }

    const amount = BigInt(amountSats || "0");
    if (amount <= 0n) {
      setError("Please enter a valid amount in satoshis");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const prepared = await prepareStealthDeposit({
        recipientMeta: resolvedMeta,
        amountSats: amount,
        network: BITCOIN_NETWORK,
      });

      setStealthDeposit(prepared);
      console.log("[Stealth Deposit] Prepared:", {
        address: prepared.btcDepositAddress,
        amount: prepared.amountSats.toString(),
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
        pending: { label: "Waiting for deposit...", color: "text-[#8B8A9E]" },
        detected: { label: "Deposit detected!", color: "text-[#F7931A]" },
        confirming: { label: `Confirming (${trackerStatus.confirmations} conf)`, color: "text-[#F7931A]" },
        confirmed: { label: "Deposit confirmed!", color: "text-[#4ADE80]" },
        ready: { label: "Ready to claim!", color: "text-[#14F195]" },
        claimed: { label: "Already claimed", color: "text-[#4ADE80]" },
      };
      return statusMap[trackerStatus.status] || { label: trackerStatus.status, color: "text-[#8B8A9E]" };
    }
    return { label: "Waiting for deposit...", color: "text-[#8B8A9E]" };
  };

  const isSecretValid = secretNote.trim().length >= 8;

  return (
    <div className="flex flex-col">
      {/* Mode Toggle */}
      <div className="flex gap-2 mb-4 p-1 bg-[#16161B] rounded-[10px] border border-[#8B8A9E26]">
        <button
          onClick={() => { setMode("note"); resetFlow(); }}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[8px] text-body2 transition-colors",
            mode === "note"
              ? "bg-[#14F19520] text-[#14F195] border border-[#14F19540]"
              : "text-[#8B8A9E] hover:text-[#C7C5D1]"
          )}
        >
          <User className="w-4 h-4" />
          Self (Note)
        </button>
        <button
          onClick={() => { setMode("stealth"); resetFlow(); }}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[8px] text-body2 transition-colors",
            mode === "stealth"
              ? "bg-[#9945FF20] text-[#9945FF] border border-[#9945FF40]"
              : "text-[#8B8A9E] hover:text-[#C7C5D1]"
          )}
        >
          <Send className="w-4 h-4" />
          Send to Address
        </button>
      </div>

      {/* Stealth Address Section - for receiving from others (only in note mode) */}
      {mode === "note" && (
        <div className="mb-4 p-3 bg-[#14F1950D] border border-[#14F19526] rounded-[12px]">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-[#14F195]" />
            <span className="text-caption text-[#14F195]">Your Stealth Address</span>
          </div>
          {!keys ? (
            <div className="flex items-center justify-between">
              <span className="text-caption text-[#8B8A9E]">
                Sign to derive your private address
              </span>
              <button
                onClick={deriveKeys}
                disabled={keysLoading}
                className="px-3 py-1 text-caption bg-[#14F19526] hover:bg-[#14F19533] text-[#14F195] rounded-[6px] transition-colors disabled:opacity-50"
              >
                {keysLoading ? "..." : "Derive"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-caption font-mono text-[#C7C5D1] truncate">
                {stealthAddressEncoded?.slice(0, 20)}...{stealthAddressEncoded?.slice(-20)}
              </code>
              <button
                onClick={copyStealthAddress}
                className="p-1.5 rounded-[6px] bg-[#14F1951A] hover:bg-[#14F19533] transition-colors"
                title="Copy to share with others"
              >
                {stealthCopied ? (
                  <Check className="w-3.5 h-3.5 text-[#4ADE80]" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[#14F195]" />
                )}
              </button>
            </div>
          )}
          <p className="text-caption text-[#8B8A9E] mt-1">
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
                  ? "bg-[#9945FF20] text-[#9945FF] border border-[#9945FF40]"
                  : "bg-[#16161B] text-[#8B8A9E] border border-[#8B8A9E26] hover:text-[#C7C5D1]"
              )}
            >
              <Tag className="w-3.5 h-3.5" />
              .zkey Name
            </button>
            <button
              onClick={() => { setRecipientType("address"); setRecipient(""); setResolvedMeta(null); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[8px] text-caption transition-colors",
                recipientType === "address"
                  ? "bg-[#9945FF20] text-[#9945FF] border border-[#9945FF40]"
                  : "bg-[#16161B] text-[#8B8A9E] border border-[#8B8A9E26] hover:text-[#C7C5D1]"
              )}
            >
              <Key className="w-3.5 h-3.5" />
              Stealth Address
            </button>
          </div>

          {/* Recipient Input */}
          <div className="mb-4">
            <label className="text-body2 text-[#C7C5D1] pl-2 mb-2 block">
              {recipientType === "zkey" ? "Recipient .zkey Name" : "Recipient Stealth Address"}
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => { setRecipient(e.target.value); setResolvedMeta(null); setStealthDeposit(null); }}
                  placeholder={recipientType === "zkey" ? "alice" : "Paste stealth meta-address (132 hex chars)"}
                  className={cn(
                    "w-full p-3 bg-[#16161B] border border-[#8B8A9E26] rounded-[12px]",
                    "text-body2 font-mono text-[#F1F0F3] placeholder:text-[#8B8A9E]",
                    "outline-none focus:border-[#9945FF66] transition-colors",
                    recipientType === "zkey" ? "pr-16" : ""
                  )}
                />
                {recipientType === "zkey" && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-body2 text-[#8B8A9E]">.zkey</span>
                )}
              </div>
              <button
                onClick={resolveRecipient}
                disabled={!recipient.trim() || resolvingRecipient}
                className={cn(
                  "px-4 py-2 rounded-[10px] text-body2 transition-colors",
                  "bg-[#9945FF] hover:bg-[#8B3DE8] text-white",
                  "disabled:bg-[#8B8A9E33] disabled:text-[#8B8A9E] disabled:cursor-not-allowed"
                )}
              >
                {resolvingRecipient ? "..." : "Resolve"}
              </button>
            </div>
          </div>

          {/* Resolved recipient info */}
          {resolvedMeta && (
            <div className="mb-4 p-3 bg-[#9945FF0D] border border-[#9945FF26] rounded-[12px]">
              <div className="flex items-center gap-2 mb-1">
                <Check className="w-4 h-4 text-[#4ADE80]" />
                <span className="text-caption text-[#4ADE80]">Recipient resolved</span>
              </div>
              <p className="text-caption text-[#8B8A9E]">
                Stealth keys found. Enter amount to generate deposit address.
              </p>
            </div>
          )}

          {/* Amount Input (only after resolving) */}
          {resolvedMeta && !stealthDeposit && (
            <div className="mb-4">
              <label className="text-body2 text-[#C7C5D1] pl-2 mb-2 block">Amount (satoshis)</label>
              <input
                type="number"
                value={amountSats}
                onChange={(e) => setAmountSats(e.target.value)}
                placeholder="e.g., 100000 (= 0.001 BTC)"
                className={cn(
                  "w-full p-3 bg-[#16161B] border border-[#8B8A9E26] rounded-[12px]",
                  "text-body2 font-mono text-[#F1F0F3] placeholder:text-[#8B8A9E]",
                  "outline-none focus:border-[#9945FF66] transition-colors"
                )}
              />
              <p className="text-caption text-[#8B8A9E] mt-1 pl-2">
                {amountSats ? `= ${(Number(amountSats) / 100_000_000).toFixed(8)} BTC` : "Enter exact amount to deposit"}
              </p>
            </div>
          )}

          {/* Generate Stealth Deposit Button */}
          {resolvedMeta && !stealthDeposit && (
            <button
              onClick={generateStealthDeposit}
              disabled={loading || !amountSats || BigInt(amountSats || "0") <= 0n}
              className={cn(
                "btn-primary w-full mb-4",
                "disabled:bg-[#8B8A9E33] disabled:text-[#8B8A9E] disabled:cursor-not-allowed"
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
                  Generate Stealth Deposit
                </>
              )}
            </button>
          )}

          {/* Stealth Deposit Result */}
          {stealthDeposit && (
            <>
              {/* Deposit Address */}
              <div className="gradient-bg-bitcoin p-4 rounded-[12px] mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-caption text-[#8B8A9E]">Send BTC to this address</p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowQR(!showQR)}
                      className={cn(
                        "p-1.5 rounded-[6px] transition-colors",
                        showQR ? "bg-[#F7931A33] text-[#F7931A]" : "bg-[#F7931A1A] text-[#F7931A] hover:bg-[#F7931A33]"
                      )}
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { navigator.clipboard.writeText(stealthDeposit.btcDepositAddress); setAddressCopied(true); setTimeout(() => setAddressCopied(false), 2000); }}
                      className="p-1.5 rounded-[6px] bg-[#F7931A1A] hover:bg-[#F7931A33] transition-colors"
                    >
                      {addressCopied ? <Check className="w-4 h-4 text-[#4ADE80]" /> : <Copy className="w-4 h-4 text-[#F7931A]" />}
                    </button>
                  </div>
                </div>
                <code className="text-body2 font-mono text-[#F7931A] break-all block">
                  {stealthDeposit.btcDepositAddress}
                </code>
              </div>

              {/* QR Code */}
              {showQR && (
                <div className="flex justify-center p-4 rounded-[12px] mb-4">
                  <QRCodeSVG
                    value={stealthDeposit.btcDepositAddress}
                    size={180}
                    level="M"
                    bgColor="transparent"
                    fgColor="#F7931A"
                  />
                </div>
              )}

              {/* Amount Info */}
              <div className="gradient-bg-card p-4 rounded-[12px] mb-4 border border-[#9945FF33]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-body2 text-[#C7C5D1]">Amount</span>
                  <span className="text-body2-semibold text-[#F7931A]">
                    {stealthDeposit.amountSats.toString()} sats
                  </span>
                </div>
                <p className="text-caption text-[#8B8A9E]">
                  Send exactly this amount. Recipient will be able to scan and claim.
                </p>
              </div>

              {/* Important Note */}
              <div className="p-3 bg-[#F7931A1A] border border-[#F7931A33] rounded-[12px] mb-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-[#F7931A] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-caption text-[#F7931A] font-medium">Important</p>
                    <p className="text-caption text-[#8B8A9E]">
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
      {/* Secret note input */}
      <div className="mb-4">
        <label className="text-body2 text-[#C7C5D1] pl-2 mb-2 block">Secret Note</label>
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
            className={cn(
              "w-full p-3 pr-24 bg-[#16161B] border border-[#8B8A9E26] rounded-[12px]",
              "text-body2 font-mono text-[#F1F0F3] placeholder:text-[#8B8A9E]",
              "outline-none focus:border-[#14F19566] transition-colors"
            )}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="p-2 text-[#8B8A9E] hover:text-[#C7C5D1] transition-colors"
              title={showSecret ? "Hide secret" : "Show secret"}
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={handleGenerateSecret}
              className="p-2 text-[#14F195] hover:text-[#4ADE80] transition-colors"
              title="Generate random secret"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
        <p className="text-caption text-[#8B8A9E] mt-1 pl-2">
          {isSecretValid ? "Your secret is valid. Address generated below." : "Enter at least 8 characters to generate deposit address."}
        </p>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-4 text-[#8B8A9E]">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="text-body2">Generating deposit address...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="warning-box mb-4">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Deposit Data Section - shown when depositData exists */}
      {depositData && (
        <>
          {/* Deposit Address */}
          <div className="gradient-bg-bitcoin p-4 rounded-[12px] mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-caption text-[#8B8A9E]">Deposit Address</p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowQR(!showQR)}
                  className={cn(
                    "p-1.5 rounded-[6px] transition-colors",
                    showQR ? "bg-[#F7931A33] text-[#F7931A]" : "bg-[#F7931A1A] text-[#F7931A] hover:bg-[#F7931A33]"
                  )}
                  title={showQR ? "Hide QR code" : "Show QR code"}
                >
                  <QrCode className="w-4 h-4" />
                </button>
                <button
                  onClick={copyAddress}
                  className="p-1.5 rounded-[6px] bg-[#F7931A1A] hover:bg-[#F7931A33] transition-colors"
                  title="Copy address"
                >
                  {addressCopied ? (
                    <Check className="w-4 h-4 text-[#4ADE80]" />
                  ) : (
                    <Copy className="w-4 h-4 text-[#F7931A]" />
                  )}
                </button>
              </div>
            </div>
            <code className="text-body2 font-mono text-[#F7931A] break-all block">
              {depositData.taproot_address}
            </code>
          </div>

          {/* QR Code - toggleable */}
          {showQR && (
            <div className="flex justify-center p-4 rounded-[12px] mb-4">
              <QRCodeSVG
                value={depositData.taproot_address}
                size={180}
                level="M"
                bgColor="transparent"
                fgColor="#F7931A"
              />
            </div>
          )}

          {/* Claim Link */}
          {/* Secret = Claim Link (simplified!) */}
          <div className="gradient-bg-card p-4 rounded-[12px] mb-4 border border-[#14F19533]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-[#14F195]" />
                <span className="text-caption text-[#14F195]">Your Secret (Save This!)</span>
              </div>
              <button
                onClick={() => copy(secretNote)}
                className="p-1.5 rounded-[6px] bg-[#14F1951A] hover:bg-[#14F19533] transition-colors"
                title="Copy secret"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-[#4ADE80]" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[#14F195]" />
                )}
              </button>
            </div>
            <code className="text-body2 font-mono text-[#F1F0F3] block mb-2">
              {showSecret ? secretNote : "••••••••••••••••"}
            </code>
            <p className="text-caption text-[#8B8A9E]">
              This secret is your claim link. Remember it or save it to claim your zBTC later.
            </p>
          </div>

          {/* Deposit Status */}
          <div className="gradient-bg-card p-4 rounded-[12px] mb-4">
            <div className="flex items-center justify-between">
              <span className="text-body2 text-[#C7C5D1]">Status</span>
              <span className={cn("text-body2-semibold", getStatusDisplay().color)}>
                {getStatusDisplay().label}
              </span>
            </div>

            {/* Backend Tracker Progress */}
            {trackerId && trackerStatus.status && !["pending"].includes(trackerStatus.status) && (
              <div className="mt-3 pt-3 border-t border-[#8B8A9E26]">
                <DepositProgress
                  status={trackerStatus.status}
                  confirmations={trackerStatus.confirmations}
                  sweepConfirmations={trackerStatus.sweepConfirmations}
                />
              </div>
            )}
          </div>

          {/* Testnet faucet link */}
          <div className="flex items-center justify-between p-3 bg-[#16161B] border border-[#8B8A9E26] rounded-[12px] mb-4">
            <span className="text-caption text-[#8B8A9E]">Need testnet BTC?</span>
            <a
              href="https://coinfaucet.eu/en/btc-testnet/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-caption text-[#F7931A] hover:text-[#FFA940] transition-colors flex items-center gap-1"
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
