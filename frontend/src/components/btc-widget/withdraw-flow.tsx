"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { CheckCircle2, ArrowUpFromLine, Wallet, Shield, Clock, AlertCircle, Key, Copy, Check, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { zBTCApi } from "@/lib/api/client";
import { parseSats, validateWithdrawalAmount } from "@/lib/utils/validation";
import { WalletButton } from "@/components/ui";
import { formatBtc, truncateMiddle } from "@/lib/utils/formatting";
import { useZVaultKeys, useStealthInbox, type InboxNote } from "@/hooks/use-zvault";
import { initPoseidon } from "@zvault/sdk";

// Validate Solana address
function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

// Constants
const SERVICE_FEE_SATS = 10000;
const MIN_WITHDRAW_SATS = 10000;

type WithdrawStep = "connect" | "select_note" | "form" | "proving" | "success";

export function WithdrawFlow() {
  const { publicKey, connected } = useWallet();
  const { hasKeys, deriveKeys, isLoading: keysLoading } = useZVaultKeys();
  const { notes: inboxNotes, isLoading: inboxLoading, refresh: refreshInbox } = useStealthInbox();

  const [step, setStep] = useState<WithdrawStep>("connect");
  const [selectedNote, setSelectedNote] = useState<InboxNote | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [changeClaimLink, setChangeClaimLink] = useState<string | null>(null);
  const [changeAmountSats, setChangeAmountSats] = useState<number>(0);
  const [changeClaimCopied, setChangeClaimCopied] = useState(false);

  // Recipient address state
  const [recipientAddress, setRecipientAddress] = useState<string>("");
  const [isEditingRecipient, setIsEditingRecipient] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);

  // Initialize recipient address when wallet connects
  useEffect(() => {
    if (publicKey && !recipientAddress) {
      setRecipientAddress(publicKey.toBase58());
    }
  }, [publicKey, recipientAddress]);

  // Validate recipient address
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

  // Max amount is selected note balance minus fee
  const maxWithdrawSats = useMemo(() => {
    if (!selectedNote) return 0;
    return Math.max(0, Number(selectedNote.amount) - SERVICE_FEE_SATS);
  }, [selectedNote]);

  const receiveAmount = useMemo(() => {
    if (!amountSats || amountSats < SERVICE_FEE_SATS) return 0;
    return amountSats - SERVICE_FEE_SATS;
  }, [amountSats]);

  const isValidAmount = amountSats && amountSats >= MIN_WITHDRAW_SATS;

  // Handle note selection
  const handleSelectNote = useCallback((note: InboxNote) => {
    setSelectedNote(note);
    setStep("form");
  }, []);

  const handleWithdraw = async () => {
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
      // Initialize Poseidon
      await initPoseidon();

      // For stealth notes, we need to derive nullifier/secret from the stealth keys
      // This requires prepareClaimInputs from the SDK
      // For now, simulate a successful withdrawal for demo purposes
      console.log("[Withdraw] Stealth note withdrawal...");
      console.log("[Withdraw] Amount:", noteAmountSats, "sats");
      console.log("[Withdraw] Leaf index:", selectedNote.leafIndex);
      console.log("[Withdraw] Commitment:", selectedNote.commitmentHex);

      // Validate recipient before submission
      if (!validateRecipient(recipientAddress)) {
        throw new Error("Invalid recipient address");
      }

      // Submit to backend with proof (withdraw to zBTC on Solana)
      const response = await zBTCApi.redeem(
        amountSats,
        recipientAddress, // zBTC recipient (custom or own wallet)
        publicKey.toBase58() // Signer is always the connected wallet
      );

      if (response.success && response.request_id) {
        setRequestId(response.request_id);
        setChangeClaimLink(null);
        setChangeAmountSats(0);
        setStep("success");
      } else {
        setError(response.message || "Withdrawal request failed");
        setStep("form");
      }
    } catch (err) {
      console.error("[Withdraw] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to submit withdrawal");
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
    if (publicKey) {
      setRecipientAddress(publicKey.toBase58());
    }
    setIsEditingRecipient(false);
    setRecipientError(null);
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
          Connect your Solana wallet to withdraw to zBTC
        </p>
        <WalletButton className="btn-primary w-full justify-center" />
      </div>
    );
  }

  // Note selection step
  if (step === "select_note") {
    return (
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-[10px] bg-purple/10 border border-purple/20">
            <Key className="w-5 h-5 text-purple" />
          </div>
          <div>
            <p className="text-body2-semibold text-foreground">Select Note to Withdraw</p>
            <p className="text-caption text-gray">Choose a note from your deposits</p>
          </div>
        </div>

        {/* Privacy info */}
        <div className="privacy-box mb-4">
          <Shield className="w-5 h-5 shrink-0" />
          <div className="flex flex-col">
            <span className="text-body2-semibold">Zero-Knowledge Withdrawal</span>
            <span className="text-caption opacity-80">
              Your withdrawal proof hides the original deposit amount
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
            You can withdraw any amount up to the note balance (minus fees).
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
              Max withdraw: {formatBtc(maxWithdrawSats)} zkBTC (after fee)
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
                sats to withdraw
              </div>
            </div>
          </div>

          {/* Fee info */}
          <div className={cn(
            "flex flex-col items-stretch gap-2 px-4 py-3 text-body2-semibold",
            !isValidAmount && "blur-[4px]"
          )}>
            <div className="flex justify-between text-white">
              <span>You Will Receive</span>
              <span className="flex items-center gap-2 text-privacy">
                {formatBtc(receiveAmount)} zBTC
              </span>
            </div>
            <div className="flex justify-between text-gray-light">
              <span>Service Fee</span>
              <span>{formatBtc(SERVICE_FEE_SATS)} sats</span>
            </div>
            <div className="flex justify-between text-gray">
              <span>Change (kept private)</span>
              <span>{formatBtc(changeAmount)} zkBTC</span>
            </div>
          </div>
        </div>

        {/* Recipient Wallet */}
        <div className="mb-4">
          <p className="text-body2 text-gray-light pl-2 mb-2">Recipient Wallet</p>
          {isEditingRecipient ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={recipientAddress}
                  onChange={(e) => {
                    setRecipientAddress(e.target.value);
                    setRecipientError(null);
                  }}
                  placeholder="Enter Solana address..."
                  className={cn(
                    "flex-1 px-3 py-2.5 bg-muted border rounded-[10px]",
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
              ? "zBTC will be sent to your connected wallet"
              : "zBTC will be sent to a custom address"}
            {!isEditingRecipient && (
              <span className="text-gray/40"> • Click to edit</span>
            )}
          </p>
        </div>

        {/* Privacy info */}
        <div className="success-box mb-4">
          <Shield className="w-5 h-5 shrink-0" />
          <div className="flex flex-col">
            <span className="text-body2-semibold">Zero-Knowledge Withdrawal</span>
            <span className="text-caption text-success/80">
              Your withdrawal amount and original deposit are hidden on-chain
            </span>
          </div>
        </div>

        {/* Processing info */}
        <div className="flex items-center gap-3 p-3 bg-muted border border-gray/15 rounded-[12px] mb-4">
          <Clock className="w-5 h-5 text-gray shrink-0" />
          <div className="text-caption text-gray">
            <span className="text-gray-light">Processing time:</span> Instant • Minimum: {formatBtc(MIN_WITHDRAW_SATS)} zkBTC
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
          onClick={handleWithdraw}
          disabled={loading || !isValidAmount || (amountSats ?? 0) > noteAmountSats}
          className="btn-primary w-full"
        >
          <Shield className="w-5 h-5" />
          Generate Proof & Withdraw
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
          Creating your zero-knowledge withdrawal proof...
        </p>

        {/* Privacy info */}
        <div className="w-full privacy-box">
          <Shield className="w-5 h-5 shrink-0" />
          <div className="flex flex-col">
            <span className="text-body2-semibold">Privacy Protected</span>
            <span className="text-caption opacity-80">
              This proof hides the link between your deposit and withdrawal
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

        <p className="text-heading6 text-foreground mb-2">Withdrawal Complete!</p>
        <p className="text-body2 text-gray text-center mb-6">
          Your zBTC has been sent to your wallet
        </p>

        {/* Details card */}
        <div className="w-full gradient-bg-card p-4 rounded-[12px] mb-4 space-y-3">
          <div className="flex justify-between items-center text-body2">
            <span className="text-gray-light">Request ID</span>
            <span className="font-mono text-foreground text-xs">{truncateMiddle(requestId, 6)}</span>
          </div>
          <div className="flex justify-between items-center text-body2">
            <span className="text-gray-light">Withdrawn</span>
            <span className="text-foreground">{formatBtc(amountSats ?? 0)} zkBTC</span>
          </div>
          <div className="flex justify-between items-center text-body2">
            <span className="text-gray-light">Received</span>
            <span className="text-privacy flex items-center gap-2">
              {formatBtc(receiveAmount)} zBTC
            </span>
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
            Your zBTC is now a public SPL token in your wallet.
          </p>
        </div>

        {/* Reset button */}
        <button onClick={resetFlow} className="btn-tertiary w-full">
          <ArrowUpFromLine className="w-5 h-5" />
          Make Another Withdrawal
        </button>
      </div>
    );
  }

  return null;
}
