"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { CheckCircle2, Send, Wallet, Shield, Clock, AlertCircle, Key, Copy, Check, Pencil, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseSats, validateWithdrawalAmount } from "@/lib/utils/validation";
import { WalletButton } from "@/components/ui";
import { StealthRecipientInput } from "@/components/ui/stealth-recipient-input";
import { formatBtc, truncateMiddle } from "@/lib/utils/formatting";
import { useZVaultKeys, useStealthInbox, type InboxNote } from "@/hooks/use-zvault";
import {
  initPoseidon,
  createStealthDeposit,
  type StealthMetaAddress,
} from "@zvault/sdk";

// Validate Solana address
function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

// Convert bytes to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constants
const MIN_PAY_SATS = 1000;

type PayStep = "connect" | "select_note" | "form" | "proving" | "success";

export function PayFlow() {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { hasKeys, deriveKeys, isLoading: keysLoading, stealthAddress } = useZVaultKeys();
  const { notes: inboxNotes, isLoading: inboxLoading, refresh: refreshInbox } = useStealthInbox();

  const [step, setStep] = useState<PayStep>("connect");
  const [selectedNote, setSelectedNote] = useState<InboxNote | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [changeClaimLink, setChangeClaimLink] = useState<string | null>(null);
  const [changeAmountSats, setChangeAmountSats] = useState<number>(0);
  const [changeClaimCopied, setChangeClaimCopied] = useState(false);

  // Recipient address state
  const [recipientMode, setRecipientMode] = useState<"public" | "stealth">("public");
  const [recipientAddress, setRecipientAddress] = useState<string>("");
  const [isEditingRecipient, setIsEditingRecipient] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const recipientInitializedRef = useRef(false);

  // Stealth recipient state
  const [resolvedMeta, setResolvedMeta] = useState<StealthMetaAddress | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [stealthError, setStealthError] = useState<string | null>(null);

  // Initialize recipient address when wallet connects (only once)
  useEffect(() => {
    if (publicKey && !recipientInitializedRef.current) {
      setRecipientAddress(publicKey.toBase58());
      recipientInitializedRef.current = true;
    }
  }, [publicKey]);

  // Validate recipient address (for public mode)
  const validateRecipient = useCallback((address: string): boolean => {
    if (!address.trim()) {
      setRecipientError("Recipient address is required");
      return false;
    }
    if (!isValidSolanaAddress(address)) {
      setRecipientError("Invalid Solana address");
      return false;
    }
    setRecipientError(null);
    return true;
  }, []);

  // Handle stealth recipient resolution from component
  const handleStealthResolved = useCallback((meta: StealthMetaAddress | null, name: string | null) => {
    setResolvedMeta(meta);
    setResolvedName(name);
  }, []);

  // Handle recipient edit save
  const handleSaveRecipient = useCallback(() => {
    if (validateRecipient(recipientAddress)) {
      setIsEditingRecipient(false);
    }
  }, [recipientAddress, validateRecipient]);

  // Reset to own wallet
  const handleResetRecipient = useCallback(() => {
    if (publicKey) {
      setRecipientAddress(publicKey.toBase58());
      setRecipientError(null);
      setIsEditingRecipient(false);
    }
  }, [publicKey]);

  const isOwnWallet = publicKey?.toBase58() === recipientAddress;

  // Copy change claim link to clipboard
  const copyChangeClaimLink = useCallback(async () => {
    if (!changeClaimLink) return;
    const fullUrl = `${window.location.origin}/claim?note=${changeClaimLink}`;
    await navigator.clipboard.writeText(fullUrl);
    setChangeClaimCopied(true);
    setTimeout(() => setChangeClaimCopied(false), 2000);
  }, [changeClaimLink]);

  // Get notes from stealth inbox (claimed stealth deposits)
  const availableNotes = useMemo(() => {
    return inboxNotes.filter((n) => n.amount > 0n);
  }, [inboxNotes]);

  const amountSats = useMemo(() => parseSats(amount), [amount]);

  // Max amount is the full note balance
  const maxPaySats = useMemo(() => {
    if (!selectedNote) return 0;
    return Number(selectedNote.amount);
  }, [selectedNote]);

  const isValidAmount = amountSats && amountSats >= MIN_PAY_SATS;

  // Handle note selection
  const handleSelectNote = useCallback((note: InboxNote) => {
    setSelectedNote(note);
    setStep("form");
  }, []);

  const handlePay = async () => {
    if (!publicKey || !selectedNote) return;

    const amountValidation = validateWithdrawalAmount(amountSats ?? 0);
    if (!amountValidation.valid) {
      setError(amountValidation.error || "Invalid amount");
      return;
    }

    if (!amountSats) return;

    const noteAmountSats = Number(selectedNote.amount);
    // Check amount doesn't exceed note balance
    if (amountSats > noteAmountSats) {
      setError(`Amount exceeds note balance (${noteAmountSats} sats)`);
      return;
    }

    setLoading(true);
    setError(null);
    setStep("proving");

    try {
      // Initialize Poseidon for hashing
      await initPoseidon();

      console.log("[Pay] Processing payment...");
      console.log("[Pay] Amount:", amountSats, "sats");
      console.log("[Pay] Leaf index:", selectedNote.leafIndex);
      console.log("[Pay] Commitment:", selectedNote.commitmentHex);
      console.log("[Pay] Mode:", recipientMode);

      // Determine target stealth meta address
      let targetMeta: StealthMetaAddress | null = null;

      if (recipientMode === "stealth") {
        // Stealth mode: use resolved meta address
        if (!resolvedMeta) {
          throw new Error("Please resolve stealth recipient first");
        }
        targetMeta = resolvedMeta;
      } else {
        // Public mode: Create a deposit that recipient can claim
        // Since contract doesn't support direct transfer to Solana wallet,
        // we create a deposit to sender's stealth address and generate a claim link
        // that can be shared with the recipient
        if (!stealthAddress) {
          throw new Error("Please derive your stealth keys first");
        }
        targetMeta = stealthAddress;
      }

      // Validate recipient address for public mode
      if (recipientMode === "public" && !validateRecipient(recipientAddress)) {
        throw new Error("Invalid recipient address");
      }

      // Create stealth deposit data client-side
      const stealthDepositData = await createStealthDeposit(targetMeta, BigInt(amountSats));

      console.log("[Pay] Created stealth deposit, submitting via relayer...");

      // Submit via demo API relayer (keeps user anonymous)
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "stealth",
          ephemeralPub: bytesToHex(stealthDepositData.ephemeralPub),
          commitment: bytesToHex(stealthDepositData.commitment),
          encryptedAmount: bytesToHex(stealthDepositData.encryptedAmount),
        }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "Failed to submit payment");
      }

      console.log("[Pay] Transaction confirmed:", result.signature);

      // Calculate change if partial payment
      const noteAmountSats = Number(selectedNote.amount);
      const changeAmount = noteAmountSats - amountSats;

      if (changeAmount > 0) {
        setChangeAmountSats(changeAmount);
        setChangeClaimLink(null);
        console.log("[Pay] Change amount:", changeAmount, "sats");
      }

      setRequestId(result.signature);
      setStep("success");
    } catch (err) {
      console.error("[Pay] Error:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to process payment";
      setError(errorMessage);
      setStep("form");
    } finally {
      setLoading(false);
    }
  };

  const resetFlow = () => {
    setStep(availableNotes.length > 0 ? "select_note" : "connect");
    setSelectedNote(null);
    setAmount("");
    setError(null);
    setRequestId(null);
    setChangeClaimLink(null);
    setChangeAmountSats(0);
    // Reset recipient to own wallet
    setRecipientMode("public");
    if (publicKey) {
      setRecipientAddress(publicKey.toBase58());
    }
    setIsEditingRecipient(false);
    setRecipientError(null);
    // Reset stealth state
    setResolvedMeta(null);
    setResolvedName(null);
    setStealthError(null);
  };

  useEffect(() => {
    if (connected && hasKeys && step === "connect") {
      // Move to note selection if notes available, otherwise stay for info
      setStep(availableNotes.length > 0 ? "select_note" : "connect");
    } else if (!connected && step !== "connect") {
      setStep("connect");
    }
  }, [connected, hasKeys, step, availableNotes.length]);

  // Connect step - also shows if no notes available
  if (step === "connect") {
    // If connected but no keys, prompt to derive
    if (connected && !hasKeys) {
      return (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="rounded-full bg-purple/10 p-4 mb-4">
            <Key className="h-10 w-10 text-purple" />
          </div>
          <p className="text-heading6 text-foreground mb-2">Derive Your Keys</p>
          <p className="text-body2 text-gray text-center mb-6">
            Sign a message to derive your stealth keys and scan for deposits
          </p>
          <button
            onClick={deriveKeys}
            disabled={keysLoading}
            className="btn-primary w-full justify-center"
          >
            {keysLoading ? "Deriving..." : "Derive Keys"}
          </button>
        </div>
      );
    }

    // If connected with keys but no notes, show info
    if (connected && hasKeys && availableNotes.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="rounded-full bg-gray/10 p-4 mb-4">
            <Key className="h-10 w-10 text-gray" />
          </div>
          <p className="text-heading6 text-foreground mb-2">No Notes Available</p>
          <p className="text-body2 text-gray text-center mb-4">
            {inboxLoading ? "Scanning for deposits..." : "You need to receive a stealth deposit first."}
          </p>
          <div className="privacy-box mb-4 w-full">
            <Shield className="w-5 h-5 shrink-0" />
            <div className="flex flex-col">
              <span className="text-body2-semibold">Privacy Note</span>
              <span className="text-caption opacity-80">
                Notes from stealth deposits are scanned using your viewing key.
              </span>
            </div>
          </div>
          <button
            onClick={refreshInbox}
            disabled={inboxLoading}
            className="btn-secondary w-full justify-center"
          >
            {inboxLoading ? "Scanning..." : "Refresh Inbox"}
          </button>
        </div>
      );
    }

    // Not connected
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="rounded-full bg-purple/10 p-4 mb-4">
          <Wallet className="h-10 w-10 text-purple" />
        </div>
        <p className="text-heading6 text-foreground mb-2">Connect Your Wallet</p>
        <p className="text-body2 text-gray text-center mb-6">
          Connect your Solana wallet to send payments
        </p>
        <WalletButton className="btn-primary w-full justify-center" />
      </div>
    );
  }

  // Note selection step
  if (step === "select_note") {
    return (
      <div className="flex flex-col">
        {/* Privacy info */}
        <div className="privacy-box mb-4">
          <Shield className="w-5 h-5 shrink-0" />
          <div className="flex flex-col">
            <span className="text-body2-semibold">Zero-Knowledge Payment</span>
            <span className="text-caption opacity-80">
              Your payment proof hides the original deposit amount
            </span>
          </div>
        </div>

        {/* Notes list */}
        <div className="space-y-2 mb-4">
          {availableNotes.map((note, index) => (
            <button
              key={`${note.commitmentHex}-${index}`}
              onClick={() => handleSelectNote(note)}
              className={cn(
                "w-full p-4 rounded-[12px] text-left transition-all",
                "bg-muted border border-gray/15",
                "hover:border-purple/40 hover:bg-purple/5"
              )}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-body2-semibold text-foreground">
                  {formatBtc(Number(note.amount))} zkBTC
                </span>
                <span className="text-caption text-gray">
                  {Number(note.amount).toLocaleString()} sats
                </span>
              </div>
              <div className="text-caption text-gray font-mono truncate">
                {truncateMiddle(note.commitmentHex, 8)}
              </div>
            </button>
          ))}
        </div>

        {/* Info */}
        <div className="flex items-center gap-3 p-3 bg-muted border border-gray/15 rounded-[12px]">
          <AlertCircle className="w-5 h-5 text-gray shrink-0" />
          <p className="text-caption text-gray">
            You can send any amount up to the note balance.
          </p>
        </div>
      </div>
    );
  }

  // Form step
  if (step === "form" && selectedNote) {
    const noteAmountSats = Number(selectedNote.amount);
    const changeAmount = (amountSats ?? 0) <= noteAmountSats
      ? noteAmountSats - (amountSats ?? 0)
      : 0;

    return (
      <div className="flex flex-col text-start">
        {/* Selected note info */}
        <div className="flex items-center gap-3 p-3 mb-4 bg-purple/5 border border-purple/20 rounded-[12px]">
          <Key className="w-5 h-5 text-purple shrink-0" />
          <div className="flex-1">
            <div className="flex justify-between items-center">
              <span className="text-body2-semibold text-foreground">
                Note Balance: {formatBtc(noteAmountSats)} zkBTC
              </span>
              <button
                onClick={() => setStep("select_note")}
                className="text-caption text-purple hover:text-gray-light transition-colors"
              >
                Change
              </button>
            </div>
            <span className="text-caption text-gray">
              Max: {formatBtc(maxPaySats)} zkBTC
            </span>
          </div>
        </div>

        {/* Header */}
        <div className="mb-4">
          <p className="text-body2 text-gray-light pl-2">Enter Amount</p>
        </div>

        {/* Amount Input */}
        <div className="w-full flex flex-col bg-background/50 rounded-[12px] text-start mb-4">
          <div className="flex flex-row border border-solid border-gray/20 p-[6px] pr-4 rounded-[inherit]">
            {/* zkBTC Badge */}
            <div className="w-[135px] h-[72px] flex items-center gap-2 border border-solid border-gray/15 bg-card rounded-[8px] text-body1 text-foreground p-3 shrink-0">
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-violet-500 to-purple-500 flex items-center justify-center text-[10px] font-bold text-white">zk</div>
              zkBTC
            </div>

            {/* Input */}
            <div className="flex flex-col grow justify-center">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min="0"
                max={noteAmountSats}
                className={cn(
                  "px-4 py-1 w-full flex-1 text-heading5 outline-none",
                  "bg-transparent text-foreground placeholder:text-gray",
                  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                )}
                style={{
                  boxShadow:
                    "0px -1px 0px 0px rgba(139, 138, 158, 0.25) inset, 0px -2px 0px 0px var(--background) inset",
                }}
              />
              <div className="px-4 py-[6px] text-body2 text-gray">
                sats to send
              </div>
            </div>
          </div>

          {/* Amount info */}
          <div className={cn(
            "flex flex-col items-stretch gap-2 px-4 py-3 text-body2-semibold",
            !isValidAmount && "blur-[4px]"
          )}>
            <div className="flex justify-between text-white">
              <span>Recipient Gets</span>
              <span className="flex items-center gap-2 text-privacy">
                {formatBtc(amountSats ?? 0)} zBTC
              </span>
            </div>
            <div className="flex justify-between text-gray">
              <span>Your Change (kept private)</span>
              <span>{formatBtc(changeAmount)} zkBTC</span>
            </div>
          </div>
        </div>

        {/* Recipient Wallet */}
        <div className="mb-4">
          <p className="text-body2 text-gray-light pl-2 mb-2">Recipient</p>

          {/* Mode Toggle */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => {
                setRecipientMode("public");
                setRecipientError(null);
              }}
              className={cn(
                "flex-1 px-3 py-2 rounded-[10px] text-body2 transition-colors",
                recipientMode === "public"
                  ? "bg-privacy/20 border border-privacy/40 text-privacy"
                  : "bg-muted border border-gray/20 text-gray hover:border-gray/40"
              )}
            >
              Public (Solana)
            </button>
            <button
              onClick={() => {
                setRecipientMode("stealth");
                setRecipientError(null);
              }}
              className={cn(
                "flex-1 px-3 py-2 rounded-[10px] text-body2 transition-colors",
                recipientMode === "stealth"
                  ? "bg-purple/20 border border-purple/40 text-purple"
                  : "bg-muted border border-gray/20 text-gray hover:border-gray/40"
              )}
            >
              Private (Stealth)
            </button>
          </div>

          {/* Public Mode - Solana Address */}
          {recipientMode === "public" && (
            <>
              {isEditingRecipient ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={recipientAddress}
                      onChange={(e) => {
                        setRecipientAddress(e.target.value);
                        setRecipientError(null);
                      }}
                      placeholder="Enter Solana address..."
                      className={cn(
                        "flex-1 px-4 py-3 bg-muted border rounded-[10px]",
                        "text-body2 font-mono text-gray-light placeholder:text-gray/40",
                        "outline-none transition-colors",
                        recipientError
                          ? "border-red-500/50"
                          : "border-gray/20 focus:border-purple/40"
                      )}
                    />
                    <button
                      onClick={handleSaveRecipient}
                      className="p-2.5 rounded-[10px] bg-privacy/10 hover:bg-privacy/20 text-privacy transition-colors"
                      title="Save"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        handleResetRecipient();
                      }}
                      className="p-2.5 rounded-[10px] bg-gray/10 hover:bg-gray/20 text-gray transition-colors"
                      title="Cancel"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {recipientError && (
                    <p className="text-caption text-red-400 pl-2">{recipientError}</p>
                  )}
                  {publicKey && recipientAddress !== publicKey.toBase58() && (
                    <button
                      onClick={handleResetRecipient}
                      className="text-caption text-purple hover:text-purple/80 pl-2 transition-colors"
                    >
                      Reset to my wallet
                    </button>
                  )}
                </div>
              ) : (
                <div
                  className={cn(
                    "flex items-center gap-2 p-3 rounded-[12px] cursor-pointer transition-colors",
                    "bg-muted border",
                    isOwnWallet
                      ? "border-privacy/20 hover:border-privacy/40"
                      : "border-purple/20 hover:border-purple/40"
                  )}
                  onClick={() => setIsEditingRecipient(true)}
                >
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    isOwnWallet ? "bg-privacy" : "bg-purple"
                  )} />
                  <span className="flex-1 text-body2 font-mono text-gray-light truncate">
                    {recipientAddress ? truncateMiddle(recipientAddress, 8) : "—"}
                  </span>
                  <Pencil className="w-3.5 h-3.5 text-gray" />
                </div>
              )}
              <p className="text-caption text-gray mt-1 pl-2">
                {isOwnWallet
                  ? "Creates a private deposit (appears in your Notes)"
                  : "Creates a claimable deposit - share claim link with recipient"}
                {!isEditingRecipient && (
                  <span className="text-gray/40"> • Click to edit</span>
                )}
              </p>
            </>
          )}

          {/* Stealth Mode - .zkey or hex address */}
          {recipientMode === "stealth" && (
            <div className="space-y-2">
              <StealthRecipientInput
                onResolved={handleStealthResolved}
                resolvedMeta={resolvedMeta}
                resolvedName={resolvedName}
                error={stealthError}
                onError={setStealthError}
              />
              <p className="text-caption text-gray pl-2">
                zkBTC will be sent privately to the stealth address
              </p>
            </div>
          )}
        </div>

        {/* Privacy info */}
        <div className="success-box mb-4">
          <Shield className="w-5 h-5 shrink-0" />
          <div className="flex flex-col">
            <span className="text-body2-semibold">Zero-Knowledge Payment</span>
            <span className="text-caption text-success/80">
              Payment amount and original deposit are hidden on-chain
            </span>
          </div>
        </div>

        {/* Processing info */}
        <div className="flex items-center gap-3 p-3 bg-muted border border-gray/15 rounded-[12px] mb-4">
          <Clock className="w-5 h-5 text-gray shrink-0" />
          <div className="text-caption text-gray">
            <span className="text-gray-light">Processing time:</span> Instant
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="warning-box mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={handlePay}
          disabled={loading || !isValidAmount || (amountSats ?? 0) > noteAmountSats}
          className="btn-primary w-full"
        >
          <Send className="w-5 h-5" />
          Generate Proof & Pay
        </button>
      </div>
    );
  }

  // Proving step
  if (step === "proving") {
    return (
      <div className="flex flex-col items-center py-6">
        {/* Progress circle */}
        <div className="relative w-20 h-20 mb-4">
          <div className="absolute inset-0 rounded-full border-4 border-gray/15" />
          <div
            className="absolute inset-0 rounded-full border-4 border-purple border-t-transparent animate-spin"
            style={{ animationDuration: "2s" }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <Shield className="w-8 h-8 text-purple" />
          </div>
        </div>

        <p className="text-heading6 text-foreground mb-2">Generating ZK Proof</p>
        <p className="text-body2 text-gray text-center mb-4">
          Creating your zero-knowledge payment proof...
        </p>

        {/* Privacy info */}
        <div className="w-full privacy-box">
          <Shield className="w-5 h-5 shrink-0" />
          <div className="flex flex-col">
            <span className="text-body2-semibold">Privacy Protected</span>
            <span className="text-caption opacity-80">
              This proof hides the link between your deposit and payment
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Success step
  if (step === "success" && requestId) {
    return (
      <div className="flex flex-col items-center">
        {/* Success icon */}
        <div className="rounded-full bg-success/10 p-4 mb-4">
          <CheckCircle2 className="h-12 w-12 text-success" />
        </div>

        <p className="text-heading6 text-foreground mb-2">Payment Complete!</p>
        <p className="text-body2 text-gray text-center mb-6">
          {recipientMode === "stealth"
            ? "Stealth payment submitted on-chain"
            : "Your zBTC has been sent successfully"}
        </p>

        {/* Details card */}
        <div className="w-full gradient-bg-card p-4 rounded-[12px] mb-4 space-y-3">
          <div className="flex justify-between items-center text-body2">
            <span className="text-gray-light">Transaction</span>
            <a
              href={`https://explorer.solana.com/tx/${requestId}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-privacy text-xs hover:underline flex items-center gap-1"
            >
              {truncateMiddle(requestId, 8)}
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
          <div className="flex justify-between items-center text-body2">
            <span className="text-gray-light">Amount</span>
            <span className="text-privacy">{formatBtc(amountSats ?? 0)} zBTC</span>
          </div>
          <div className="flex justify-between items-center text-body2 pt-2 border-t border-gray/15">
            <span className="text-gray-light">Destination</span>
            <span className={cn(
              "font-mono text-xs",
              isOwnWallet ? "text-foreground" : "text-purple"
            )}>
              {recipientAddress ? truncateMiddle(recipientAddress, 6) : "—"}
              {!isOwnWallet && " (custom)"}
            </span>
          </div>
        </div>

        {/* Change Claim Link - for partial withdrawals */}
        {changeClaimLink && changeAmountSats > 0 && (
          <div className="w-full gradient-bg-card p-4 rounded-[12px] mb-4 border border-privacy/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-privacy" />
                <span className="text-body2-semibold text-privacy">Change Claim Link</span>
              </div>
              <button
                onClick={copyChangeClaimLink}
                className="p-1.5 rounded-[6px] bg-privacy/10 hover:bg-privacy/20 transition-colors"
              >
                {changeClaimCopied ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-privacy" />
                )}
              </button>
            </div>
            <div className="mb-2 p-2 bg-background rounded-[8px]">
              <div className="flex justify-between items-center text-body2">
                <span className="text-gray">Remaining Balance</span>
                <span className="text-privacy font-semibold">{formatBtc(changeAmountSats)} zkBTC</span>
              </div>
            </div>
            <code className="text-caption font-mono text-gray-light break-all block mb-2">
              {`${typeof window !== 'undefined' ? window.location.origin : ''}/claim?note=${changeClaimLink}`}
            </code>
            <p className="text-caption text-gray">
              Save this link to claim your remaining balance later!
            </p>
          </div>
        )}

        {/* Info box */}
        <div className="w-full flex items-center gap-3 p-3 bg-privacy/10 border border-privacy/20 rounded-[12px] mb-6">
          <CheckCircle2 className="w-5 h-5 text-privacy shrink-0" />
          <p className="text-caption text-gray-light">
            {recipientMode === "stealth"
              ? "Recipient can scan and claim using their stealth keys"
              : "Deposit created on-chain. You can scan and claim it in Notes."}
          </p>
        </div>

        {/* Reset button */}
        <button onClick={resetFlow} className="btn-tertiary w-full">
          <Send className="w-5 h-5" />
          Make Another Payment
        </button>
      </div>
    );
  }

  return null;
}
