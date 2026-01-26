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
import { useNoteStorage, type StoredNote } from "@/hooks/use-note-storage";
import {
  prepareWithdrawal,
  encodeClaimLink,
  initPoseidon,
  type NoteData,
} from "@zvault/sdk";
import { generatePartialWithdrawProof, type ProofResult } from "@/lib/proofs";
import { NoteStorage } from "@/lib/proofs/storage";

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
  const { notes, getActiveNotes, deleteNote } = useNoteStorage();

  const [step, setStep] = useState<WithdrawStep>("connect");
  const [selectedNote, setSelectedNote] = useState<StoredNote | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [zkProof, setZkProof] = useState<ProofResult | null>(null);
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

  // Get notes with poseidonNote data (from deposits)
  const availableNotes = useMemo(() => {
    return getActiveNotes().filter((n) => n.poseidonNote);
  }, [getActiveNotes]);

  const amountSats = useMemo(() => parseSats(amount), [amount]);

  // Max amount is selected note balance minus fee
  const maxWithdrawSats = useMemo(() => {
    if (!selectedNote) return 0;
    return Math.max(0, selectedNote.amountSats - SERVICE_FEE_SATS);
  }, [selectedNote]);

  const receiveAmount = useMemo(() => {
    if (!amountSats || amountSats < SERVICE_FEE_SATS) return 0;
    return amountSats - SERVICE_FEE_SATS;
  }, [amountSats]);

  const isValidAmount = amountSats && amountSats >= MIN_WITHDRAW_SATS;

  // Handle note selection
  const handleSelectNote = useCallback((note: StoredNote) => {
    setSelectedNote(note);
    setStep("form");
  }, []);

  const handleWithdraw = async () => {
    if (!publicKey || !selectedNote || !selectedNote.poseidonNote) return;

    const amountValidation = validateWithdrawalAmount(amountSats ?? 0);
    if (!amountValidation.valid) {
      setError(amountValidation.error || "Invalid amount");
      return;
    }

    if (!amountSats) return;

    // Check amount doesn't exceed note balance
    if (amountSats > selectedNote.amountSats) {
      setError(`Amount exceeds note balance (${selectedNote.amountSats} sats)`);
      return;
    }

    setLoading(true);
    setError(null);
    setStep("proving");

    try {
      // Initialize Poseidon
      await initPoseidon();

      // Reconstruct the input note from stored data
      const pNote = selectedNote.poseidonNote;
      const inputNote: NoteData = {
        nullifier: BigInt(pNote.nullifier),
        secret: BigInt(pNote.secret),
        amount: BigInt(pNote.amount),
      };

      // Prepare withdrawal (creates change note)
      const withdrawAmount = BigInt(amountSats);
      const { changeNote, changeAmount } = prepareWithdrawal(inputNote, withdrawAmount);

      console.log("[Withdraw] Preparing withdrawal...");
      console.log("[Withdraw] Input amount:", inputNote.amount.toString(), "sats");
      console.log("[Withdraw] Withdraw amount:", withdrawAmount.toString(), "sats");
      console.log("[Withdraw] Change amount:", changeAmount.toString(), "sats");

      // Create local note storage for Merkle tree
      const storage = new NoteStorage();
      await storage.init();

      // Use the commitment that was stored when the note was created
      // For Noir: commitment is computed inside the circuit, but we use
      // the stored commitment for Merkle tree operations
      const commitment = selectedNote.poseidonCommitment
        ? BigInt("0x" + selectedNote.poseidonCommitment)
        : BigInt(pNote.commitment || "0");
      storage.addNote({ ...inputNote, commitment });

      const merkleProof = storage.getMerkleProof({ ...inputNote, commitment, leafIndex: 0 });
      const root = storage.getMerkleRoot();

      // Use Solana wallet public key as recipient
      const recipientHash = BigInt("0x" + Buffer.from(publicKey.toBytes()).toString("hex").slice(0, 32));

      console.log("[Withdraw] Generating ZK proof...");

      // Generate partial withdraw proof
      const proofResult = await generatePartialWithdrawProof({
        root,
        merkleProof,
        inputNote,
        withdrawAmount,
        recipient: recipientHash,
        changeNote,
      });

      if (!proofResult.success) {
        throw new Error(proofResult.error || "Failed to generate ZK proof");
      }

      setZkProof(proofResult);
      console.log("[Withdraw] ZK proof generated successfully!");
      console.log("[Withdraw] Proof size:", proofResult.proofBytes?.length, "bytes");

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
        // Mark note as used (delete from storage)
        deleteNote(selectedNote.commitment);
        // If there's change, generate claim link for the change note
        if (changeAmount > 0n) {
          console.log("[Withdraw] Change note created:", changeAmount.toString(), "sats");
          // Generate claim link for change note
          const encoded = encodeClaimLink(
            changeNote.nullifier.toString(),
            changeNote.secret.toString()
          );
          setChangeClaimLink(encoded);
          setChangeAmountSats(Number(changeAmount));
          console.log("[Withdraw] Change claim link generated");
        } else {
          setChangeClaimLink(null);
          setChangeAmountSats(0);
        }
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
    setZkProof(null);
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
    if (connected && step === "connect") {
      // Move to note selection if notes available, otherwise stay for info
      setStep(availableNotes.length > 0 ? "select_note" : "connect");
    } else if (!connected && step !== "connect") {
      setStep("connect");
    }
  }, [connected, step, availableNotes.length]);

  // Connect step - also shows if no notes available
  if (step === "connect") {
    // If connected but no notes, show info
    if (connected && availableNotes.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="rounded-full bg-[#8B8A9E1A] p-4 mb-4">
            <Key className="h-10 w-10 text-[#8B8A9E]" />
          </div>
          <p className="text-heading6 text-[#FFFFFF] mb-2">No Notes Available</p>
          <p className="text-body2 text-[#8B8A9E] text-center mb-4">
            You need to make a deposit first before you can withdraw.
          </p>
          <div className="privacy-box mb-4 w-full">
            <Shield className="w-5 h-5 shrink-0" />
            <div className="flex flex-col">
              <span className="text-body2-semibold">Privacy Note</span>
              <span className="text-caption opacity-80">
                Notes from deposits are stored locally and required for ZK withdrawals.
              </span>
            </div>
          </div>
          <p className="text-caption text-[#8B8A9E] text-center">
            Go to the Deposit tab to create a new deposit.
          </p>
        </div>
      );
    }

    // Not connected
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="rounded-full bg-[#FFABFE1A] p-4 mb-4">
          <Wallet className="h-10 w-10 text-[#FFABFE]" />
        </div>
        <p className="text-heading6 text-[#FFFFFF] mb-2">Connect Your Wallet</p>
        <p className="text-body2 text-[#8B8A9E] text-center mb-6">
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
          <div className="p-2 rounded-[10px] bg-[#FFABFE1A] border border-[#FFABFE33]">
            <Key className="w-5 h-5 text-[#FFABFE]" />
          </div>
          <div>
            <p className="text-body2-semibold text-[#FFFFFF]">Select Note to Withdraw</p>
            <p className="text-caption text-[#8B8A9E]">Choose a note from your deposits</p>
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
              key={`${note.commitment}-${index}`}
              onClick={() => handleSelectNote(note)}
              className={cn(
                "w-full p-4 rounded-[12px] text-left transition-all",
                "bg-[#16161B] border border-[#8B8A9E26]",
                "hover:border-[#FFABFE66] hover:bg-[#FFABFE0D]"
              )}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-body2-semibold text-[#FFFFFF]">
                  {formatBtc(note.amountSats)} zBTC
                </span>
                <span className="text-caption text-[#8B8A9E]">
                  {note.amountSats.toLocaleString()} sats
                </span>
              </div>
              <div className="text-caption text-[#8B8A9E] font-mono truncate">
                {truncateMiddle(note.poseidonCommitment || note.commitment, 8)}
              </div>
            </button>
          ))}
        </div>

        {/* Info */}
        <div className="flex items-center gap-3 p-3 bg-[#16161B] border border-[#8B8A9E26] rounded-[12px]">
          <AlertCircle className="w-5 h-5 text-[#8B8A9E] shrink-0" />
          <p className="text-caption text-[#8B8A9E]">
            You can withdraw any amount up to the note balance (minus fees).
          </p>
        </div>
      </div>
    );
  }

  // Form step
  if (step === "form" && selectedNote) {
    const changeAmount = (amountSats ?? 0) <= selectedNote.amountSats
      ? selectedNote.amountSats - (amountSats ?? 0)
      : 0;

    return (
      <div className="flex flex-col text-start">
        {/* Selected note info */}
        <div className="flex items-center gap-3 p-3 mb-4 bg-[#FFABFE0D] border border-[#FFABFE33] rounded-[12px]">
          <Key className="w-5 h-5 text-[#FFABFE] shrink-0" />
          <div className="flex-1">
            <div className="flex justify-between items-center">
              <span className="text-body2-semibold text-[#FFFFFF]">
                Note Balance: {formatBtc(selectedNote.amountSats)} zBTC
              </span>
              <button
                onClick={() => setStep("select_note")}
                className="text-caption text-[#FFABFE] hover:text-[#C7C5D1] transition-colors"
              >
                Change
              </button>
            </div>
            <span className="text-caption text-[#8B8A9E]">
              Max withdraw: {formatBtc(maxWithdrawSats)} zBTC (after fee)
            </span>
          </div>
        </div>

        {/* Header */}
        <div className="mb-4">
          <p className="text-body2 text-[#C7C5D1] pl-2">Enter Amount</p>
        </div>

        {/* Amount Input */}
        <div className="w-full flex flex-col bg-[#0F0F1280] rounded-[12px] text-start mb-4">
          <div className="flex flex-row border border-solid border-[#8B8A9E33] p-[6px] pr-4 rounded-[inherit]">
            {/* zBTC Badge */}
            <div className="w-[135px] h-[72px] flex items-center gap-2 border border-solid border-[#8B8A9E26] bg-[#202027] rounded-[8px] text-body1 text-[#F1F0F3] p-3 shrink-0">
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-violet-500 to-purple-500 flex items-center justify-center text-[10px] font-bold text-white">sb</div>
              zBTC
            </div>

            {/* Input */}
            <div className="flex flex-col grow justify-center">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min="0"
                max={selectedNote.amountSats}
                className={cn(
                  "px-4 py-1 w-full flex-1 text-heading5 outline-none",
                  "bg-transparent text-[#F1F0F3] placeholder:text-[#8B8A9E]",
                  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                )}
                style={{
                  boxShadow:
                    "0px -1px 0px 0px #8B8A9E40 inset, 0px -2px 0px 0px #0F0F12 inset",
                }}
              />
              <div className="px-4 py-[6px] text-body2 text-[#8B8A9E]">
                sats to withdraw
              </div>
            </div>
          </div>

          {/* Fee info */}
          <div className={cn(
            "flex flex-col items-stretch gap-2 px-4 py-3 text-body2-semibold",
            !isValidAmount && "blur-[4px]"
          )}>
            <div className="flex justify-between text-[#FFF]">
              <span>You Will Receive</span>
              <span className="flex items-center gap-2 text-[#14F195]">
                {formatBtc(receiveAmount)} zBTC
              </span>
            </div>
            <div className="flex justify-between text-[#C7C5D1]">
              <span>Service Fee</span>
              <span>{formatBtc(SERVICE_FEE_SATS)} sats</span>
            </div>
            <div className="flex justify-between text-[#8B8A9E]">
              <span>Change (kept private)</span>
              <span>{formatBtc(changeAmount)} zBTC</span>
            </div>
          </div>
        </div>

        {/* Recipient Wallet */}
        <div className="mb-4">
          <p className="text-body2 text-[#C7C5D1] pl-2 mb-2">Recipient Wallet</p>
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
                    "flex-1 px-3 py-2.5 bg-[#16161B] border rounded-[10px]",
                    "text-body2 font-mono text-[#C7C5D1] placeholder:text-[#8B8A9E66]",
                    "outline-none transition-colors",
                    recipientError
                      ? "border-red-500/50"
                      : "border-[#8B8A9E33] focus:border-[#FFABFE66]"
                  )}
                />
                <button
                  onClick={handleSaveRecipient}
                  className="p-2.5 rounded-[10px] bg-[#14F1951A] hover:bg-[#14F19533] text-[#14F195] transition-colors"
                  title="Save"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    handleResetRecipient();
                  }}
                  className="p-2.5 rounded-[10px] bg-[#8B8A9E1A] hover:bg-[#8B8A9E33] text-[#8B8A9E] transition-colors"
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
                  className="text-caption text-[#FFABFE] hover:text-[#FFABFE]/80 pl-2 transition-colors"
                >
                  Reset to my wallet
                </button>
              )}
            </div>
          ) : (
            <div
              className={cn(
                "flex items-center gap-2 p-3 rounded-[12px] cursor-pointer transition-colors",
                "bg-[#16161B] border",
                isOwnWallet
                  ? "border-[#14F19533] hover:border-[#14F19566]"
                  : "border-[#FFABFE33] hover:border-[#FFABFE66]"
              )}
              onClick={() => setIsEditingRecipient(true)}
            >
              <div className={cn(
                "w-2 h-2 rounded-full",
                isOwnWallet ? "bg-[#14F195]" : "bg-[#FFABFE]"
              )} />
              <span className="flex-1 text-body2 font-mono text-[#C7C5D1] truncate">
                {recipientAddress ? truncateMiddle(recipientAddress, 8) : "—"}
              </span>
              <Pencil className="w-3.5 h-3.5 text-[#8B8A9E]" />
            </div>
          )}
          <p className="text-caption text-[#8B8A9E] mt-1 pl-2">
            {isOwnWallet
              ? "zBTC will be sent to your connected wallet"
              : "zBTC will be sent to a custom address"}
            {!isEditingRecipient && (
              <span className="text-[#8B8A9E66]"> • Click to edit</span>
            )}
          </p>
        </div>

        {/* Privacy info */}
        <div className="success-box mb-4">
          <Shield className="w-5 h-5 shrink-0" />
          <div className="flex flex-col">
            <span className="text-body2-semibold">Zero-Knowledge Withdrawal</span>
            <span className="text-caption text-[#4ADE80]/80">
              Your withdrawal amount and original deposit are hidden on-chain
            </span>
          </div>
        </div>

        {/* Processing info */}
        <div className="flex items-center gap-3 p-3 bg-[#16161B] border border-[#8B8A9E26] rounded-[12px] mb-4">
          <Clock className="w-5 h-5 text-[#8B8A9E] shrink-0" />
          <div className="text-caption text-[#8B8A9E]">
            <span className="text-[#C7C5D1]">Processing time:</span> Instant • Minimum: {formatBtc(MIN_WITHDRAW_SATS)} zBTC
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
          disabled={loading || !isValidAmount || (amountSats ?? 0) > selectedNote.amountSats}
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
          <div className="absolute inset-0 rounded-full border-4 border-[#8B8A9E26]" />
          <div
            className="absolute inset-0 rounded-full border-4 border-[#FFABFE] border-t-transparent animate-spin"
            style={{ animationDuration: "2s" }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <Shield className="w-8 h-8 text-[#FFABFE]" />
          </div>
        </div>

        <p className="text-heading6 text-[#FFFFFF] mb-2">Generating ZK Proof</p>
        <p className="text-body2 text-[#8B8A9E] text-center mb-4">
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
        <div className="rounded-full bg-[#4ADE801A] p-4 mb-4">
          <CheckCircle2 className="h-12 w-12 text-[#4ADE80]" />
        </div>

        <p className="text-heading6 text-[#FFFFFF] mb-2">Withdrawal Complete!</p>
        <p className="text-body2 text-[#8B8A9E] text-center mb-6">
          Your zBTC has been sent to your wallet
        </p>

        {/* Details card */}
        <div className="w-full gradient-bg-card p-4 rounded-[12px] mb-4 space-y-3">
          <div className="flex justify-between items-center text-body2">
            <span className="text-[#C7C5D1]">Request ID</span>
            <span className="font-mono text-[#FFFFFF] text-xs">{truncateMiddle(requestId, 6)}</span>
          </div>
          <div className="flex justify-between items-center text-body2">
            <span className="text-[#C7C5D1]">Withdrawn</span>
            <span className="text-[#FFFFFF]">{formatBtc(amountSats ?? 0)} zBTC</span>
          </div>
          <div className="flex justify-between items-center text-body2">
            <span className="text-[#C7C5D1]">Received</span>
            <span className="text-[#14F195] flex items-center gap-2">
              {formatBtc(receiveAmount)} zBTC
            </span>
          </div>
          <div className="flex justify-between items-center text-body2 pt-2 border-t border-[#8B8A9E26]">
            <span className="text-[#C7C5D1]">Destination</span>
            <span className={cn(
              "font-mono text-xs",
              isOwnWallet ? "text-[#FFFFFF]" : "text-[#FFABFE]"
            )}>
              {recipientAddress ? truncateMiddle(recipientAddress, 6) : "—"}
              {!isOwnWallet && " (custom)"}
            </span>
          </div>
        </div>

        {/* Change Claim Link - for partial withdrawals */}
        {changeClaimLink && changeAmountSats > 0 && (
          <div className="w-full gradient-bg-card p-4 rounded-[12px] mb-4 border border-[#14F19533]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-[#14F195]" />
                <span className="text-body2-semibold text-[#14F195]">Change Claim Link</span>
              </div>
              <button
                onClick={copyChangeClaimLink}
                className="p-1.5 rounded-[6px] bg-[#14F1951A] hover:bg-[#14F19533] transition-colors"
              >
                {changeClaimCopied ? (
                  <Check className="w-3.5 h-3.5 text-[#4ADE80]" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[#14F195]" />
                )}
              </button>
            </div>
            <div className="mb-2 p-2 bg-[#0F0F12] rounded-[8px]">
              <div className="flex justify-between items-center text-body2">
                <span className="text-[#8B8A9E]">Remaining Balance</span>
                <span className="text-[#14F195] font-semibold">{formatBtc(changeAmountSats)} zBTC</span>
              </div>
            </div>
            <code className="text-caption font-mono text-[#C7C5D1] break-all block mb-2">
              {`${typeof window !== 'undefined' ? window.location.origin : ''}/claim?note=${changeClaimLink}`}
            </code>
            <p className="text-caption text-[#8B8A9E]">
              Save this link to claim your remaining balance later!
            </p>
          </div>
        )}

        {/* Info box */}
        <div className="w-full flex items-center gap-3 p-3 bg-[#14F1951A] border border-[#14F19533] rounded-[12px] mb-6">
          <CheckCircle2 className="w-5 h-5 text-[#14F195] shrink-0" />
          <p className="text-caption text-[#C7C5D1]">
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
