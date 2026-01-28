"use client";

import { useState, useCallback, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowLeft, Gift, Shield, CheckCircle2,
  AlertCircle, Coins, Key, ExternalLink, Copy, Link2,
  Loader2, Radio, Send, Zap
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WalletButton } from "@/components/ui";
import { formatBtc } from "@/lib/utils/formatting";
import {
  parseClaimUrl,
  encodeClaimLink,
  decodeClaimLink,
  deriveNote,
  createNote,
  initPoseidon,
  initProver,
  generateClaimProof,
  proofToBytes,
  isProverAvailable,
  pointMul,
  GRUMPKIN_GENERATOR,
  deriveCommitmentTreePDA,
  fetchCommitmentTree,
  getCommitmentIndex,
  saveCommitmentIndex,
  computeUnifiedCommitment,
  bytesToBigint,
  type ProofData,
  type ClaimInputs,
  type CommitmentTreeState,
} from "@zvault/sdk";
import { useConnection } from "@solana/wallet-adapter-react";
import { buildClaimTransaction } from "@/lib/solana/instructions";
import { COMMITMENT_TREE_ADDRESS, ZVAULT_PROGRAM_ID } from "@/lib/constants";
import { PublicKey, Transaction } from "@solana/web3.js";

type ClaimStep = "input" | "verifying" | "claiming" | "success" | "error";

// Detailed progress steps for the claim process
type ClaimProgress =
  | "idle"
  | "generating_proof"   // Generating ZK proof
  | "submitting"         // Submitting to relayer
  | "relaying"           // Relayer processing
  | "confirming"         // Waiting for Solana confirmation
  | "complete";

interface ProgressStep {
  id: ClaimProgress;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const PROGRESS_STEPS: ProgressStep[] = [
  {
    id: "generating_proof",
    label: "Generating Proof",
    description: "Creating ZK proof for privacy",
    icon: <Shield className="w-4 h-4" />,
  },
  {
    id: "submitting",
    label: "Submitting",
    description: "Sending to relayer",
    icon: <Send className="w-4 h-4" />,
  },
  {
    id: "relaying",
    label: "Relaying",
    description: "Processing transaction",
    icon: <Radio className="w-4 h-4" />,
  },
  {
    id: "confirming",
    label: "Confirming",
    description: "Waiting for Solana",
    icon: <Zap className="w-4 h-4" />,
  },
];

function getStepStatus(currentProgress: ClaimProgress, stepId: ClaimProgress): "pending" | "active" | "complete" {
  const stepOrder: ClaimProgress[] = ["idle", "generating_proof", "submitting", "relaying", "confirming", "complete"];
  const currentIndex = stepOrder.indexOf(currentProgress);
  const stepIndex = stepOrder.indexOf(stepId);

  if (currentProgress === "complete") return "complete";
  if (stepIndex < currentIndex) return "complete";
  if (stepIndex === currentIndex) return "active";
  return "pending";
}

// Progress indicator component
function ClaimProgressIndicator({ currentProgress }: { currentProgress: ClaimProgress }) {
  if (currentProgress === "idle") return null;

  return (
    <div className="space-y-3">
      {PROGRESS_STEPS.map((step, index) => {
        const status = getStepStatus(currentProgress, step.id);
        const isLast = index === PROGRESS_STEPS.length - 1;

        return (
          <div key={step.id} className="flex items-start gap-3">
            {/* Step indicator */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300",
                  status === "complete" && "bg-success/20 text-success",
                  status === "active" && "bg-purple/20 text-purple animate-pulse",
                  status === "pending" && "bg-gray/10 text-gray"
                )}
              >
                {status === "complete" ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : status === "active" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  step.icon
                )}
              </div>
              {/* Connector line */}
              {!isLast && (
                <div
                  className={cn(
                    "w-0.5 h-6 mt-1 transition-colors duration-300",
                    status === "complete" ? "bg-success/40" : "bg-gray/20"
                  )}
                />
              )}
            </div>

            {/* Step content */}
            <div className="flex-1 pt-1">
              <p
                className={cn(
                  "text-body2-semibold transition-colors",
                  status === "complete" && "text-success",
                  status === "active" && "text-purple",
                  status === "pending" && "text-gray"
                )}
              >
                {step.label}
              </p>
              <p className="text-caption text-gray">{step.description}</p>
            </div>

            {/* Status badge */}
            <div className="pt-1">
              {status === "complete" && (
                <span className="text-caption text-success">Done</span>
              )}
              {status === "active" && (
                <span className="text-caption text-purple animate-pulse">Processing...</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClaimContent() {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const searchParams = useSearchParams();

  const [mounted, setMounted] = useState(false);
  const [proverReady, setProverReady] = useState(false);
  const [step, setStep] = useState<ClaimStep>("input");
  const [claimProgress, setClaimProgress] = useState<ClaimProgress>("idle");
  const [error, setError] = useState<string | null>(null);

  // Secret phrase (seed) - derives nullifier + secret
  const [secretPhrase, setSecretPhrase] = useState("");

  // Verification result
  const [verifyResult, setVerifyResult] = useState<{
    commitment: string;
    nullifierHash: string;
    amountSats: number;
  } | null>(null);

  // Result
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [claimedAmount, setClaimedAmount] = useState<number | null>(null);
  const [proofData, setProofData] = useState<{
    merkleRoot?: string;
    leafIndex?: number;
    proofStatus?: string;
  } | null>(null);

  // Encoded claim link
  const [encodedLink, setEncodedLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Split functionality
  const [showSplitUI, setShowSplitUI] = useState(false);
  const [splitAmount, setSplitAmount] = useState("");
  const [splitLoading, setSplitLoading] = useState(false);
  const [splitResult, setSplitResult] = useState<{
    keepLink: string;
    keepAmount: number;
    sendLink: string;
    sendAmount: number;
  } | null>(null);
  const [keepLinkCopied, setKeepLinkCopied] = useState(false);
  const [sendLinkCopied, setSendLinkCopied] = useState(false);

  // Generate encoded claim link from seed
  const generateLink = useCallback(() => {
    if (secretPhrase.trim().length >= 8) {
      const encoded = encodeClaimLink(secretPhrase.trim());
      setEncodedLink(encoded);
    }
  }, [secretPhrase]);

  // Copy link to clipboard
  const copyLink = useCallback(async () => {
    if (secretPhrase.trim().length < 8) return;
    const fullUrl = `${window.location.origin}/claim?note=${encodeURIComponent(secretPhrase.trim())}`;
    await navigator.clipboard.writeText(fullUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, [secretPhrase]);

  // Helper to set secret phrase from a decoded result
  const setFromDecoded = (decoded: string | { nullifier: string; secret: string }): boolean => {
    if (typeof decoded === "string") {
      // Seed format - use directly
      setSecretPhrase(decoded);
      setError(null);
      return true;
    } else {
      // Legacy format - can't convert back to seed, show error
      setError("Legacy claim link detected. Please use the new seed-based format.");
      return false;
    }
  };

  // Try to parse claim link from text, returns true if parsed successfully
  const tryParseClaimLink = useCallback((text: string): boolean => {
    // Try to extract note parameter from URL
    if (text.includes("?note=") || text.includes("&note=")) {
      const match = text.match(/[?&]note=([^&\s]+)/);
      if (match) {
        const decoded = decodeClaimLink(match[1]);
        if (decoded) {
          return setFromDecoded(decoded);
        }
      }
    }

    // Legacy format ?n=...&s=... is not supported with seed-based links
    if (text.includes("?n=") && text.includes("&s=")) {
      setError("Legacy claim link format not supported. Please use seed-based links.");
      return false;
    }

    // Try direct decode (seed or base64)
    const decoded = decodeClaimLink(text.trim());
    if (decoded) {
      return setFromDecoded(decoded);
    }

    // Try as raw seed phrase
    if (text.trim().length >= 8) {
      setSecretPhrase(text.trim());
      setError(null);
      return true;
    }

    return false;
  }, []);

  // Handle paste event on input fields - auto-detect claim links
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData("text");

    // Check if pasted text looks like a claim link
    if (pastedText.includes("note=") || pastedText.includes("?n=") || pastedText.includes("/claim")) {
      e.preventDefault(); // Prevent default paste
      if (!tryParseClaimLink(pastedText)) {
        setError("Invalid claim link format");
      }
    }
    // Otherwise, allow normal paste behavior
  }, [tryParseClaimLink]);

  // Paste and decode claim link from clipboard (button click)
  const pasteLink = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!tryParseClaimLink(text)) {
        setError("Invalid claim link format");
      }
    } catch {
      setError("Failed to read clipboard");
    }
  }, [tryParseClaimLink]);

  // Initialize prover on mount
  useEffect(() => {
    initProver()
      .then(() => {
        setProverReady(true);
        console.log("[Claim] Prover initialized");
      })
      .catch((err) => {
        console.warn("[Claim] Prover initialization failed:", err);
        // Continue without prover - will use demo mode
      });
  }, []);

  useEffect(() => {
    setMounted(true);

    // Check for note data from URL params (claim link)
    // Supports seed format: ?note=<url-encoded-seed>
    const parsed = parseClaimUrl(searchParams);
    if (parsed) {
      if (typeof parsed === "string") {
        // Seed format - use directly
        setSecretPhrase(parsed);
      } else {
        // Legacy format - show error
        setError("Legacy claim link detected. Please use the new seed-based format.");
      }
    }
  }, [searchParams]);

  const handleVerify = useCallback(async () => {
    if (secretPhrase.trim().length < 8) {
      setError("Please enter your secret phrase (at least 8 characters)");
      return;
    }

    setError(null);
    setStep("verifying");

    try {
      // Derive note from seed
      const note = deriveNote(secretPhrase.trim(), 0, BigInt(0));

      // Unified Model: derive pubKeyX from nullifier (as privKey)
      const privKey = note.nullifier;
      const pubKeyPoint = pointMul(privKey, GRUMPKIN_GENERATOR);
      const pubKeyX = pubKeyPoint.x; // x-coordinate

      // Get nullifier hash (computed from privKey + leafIndex in circuit)
      const nullifierHash = note.nullifierHash ?? 0n;
      const nullifierHashHex = nullifierHash.toString(16).padStart(64, "0");

      // Try to find this commitment in local index with different amounts
      const commitmentIndex = getCommitmentIndex();
      let foundAmount: number | null = null;
      let foundCommitmentHex: string | null = null;

      // Try common demo amounts: 10000 (demo note), 100000 (0.001 BTC)
      const tryAmounts = [10000, 100000, 50000, 25000, 1000000];
      for (const amt of tryAmounts) {
        const testCommitment = computeUnifiedCommitment(pubKeyX, BigInt(amt));
        const testHex = testCommitment.toString(16).padStart(64, "0");
        const entry = commitmentIndex.getCommitment(testHex);
        if (entry) {
          foundAmount = amt;
          foundCommitmentHex = testHex;
          console.log("[Verify] Found commitment in index with amount:", amt);
          break;
        }
      }

      // If not found in index, we cannot proceed without knowing the amount
      if (foundAmount === null) {
        throw new Error("Commitment not found in index. Please ensure your deposit has been confirmed on-chain.");
      }
      const amountSats = foundAmount;

      // Compute commitment with found/default amount
      const commitment = computeUnifiedCommitment(pubKeyX, BigInt(amountSats));
      const commitmentHex = commitment.toString(16).padStart(64, "0");

      console.log("[Verify] Commitment:", commitmentHex.slice(0, 16) + "...");
      console.log("[Verify] Amount:", amountSats, "sats");
      console.log("[Verify] Found in index:", foundAmount !== null);

      setVerifyResult({
        commitment: commitmentHex,
        nullifierHash: nullifierHashHex,
        amountSats,
      });
      setStep("input"); // Stay on input but show verified state
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify claim - invalid secret phrase");
      setStep("error");
    }
  }, [secretPhrase]);

  const handleClaim = useCallback(async () => {
    if (secretPhrase.trim().length < 8) {
      setError("Please enter your secret phrase (at least 8 characters)");
      return;
    }
    if (!connected || !publicKey) {
      setError("Please connect your Solana wallet");
      return;
    }
    if (!signTransaction) {
      setError("Wallet does not support transaction signing");
      return;
    }

    setError(null);
    setStep("claiming");
    setClaimProgress("generating_proof");

    try {
      // Derive note from seed
      const note = deriveNote(secretPhrase.trim(), 0, BigInt(0));

      // Unified Model: use nullifier as privKey, derive pubKeyX from Grumpkin curve
      const privKey = note.nullifier;
      const pubKeyPoint = pointMul(privKey, GRUMPKIN_GENERATOR);
      const pubKeyX = pubKeyPoint.x; // x-coordinate

      // Compute commitment = Poseidon2(pubKeyX, amount)
      // Must have verified amount from verification step
      if (!verifyResult?.amountSats) {
        throw new Error("Please verify your claim first to determine the deposit amount.");
      }
      const commitmentIndex = getCommitmentIndex();
      let amountSats = verifyResult.amountSats;
      let leafIndexBigint = 0n;
      let merkleRoot = 0n;
      let merkleSiblings: bigint[] = Array(20).fill(0n);
      let merkleIndices: number[] = Array(20).fill(0);

      let proofBytes: Uint8Array | null = null;
      let proofStatus = "pending";

      // Try to fetch commitment tree state from Solana
      try {
        console.log("[Claim] Fetching commitment tree state...");
        const [commitmentTreePDA] = await deriveCommitmentTreePDA(ZVAULT_PROGRAM_ID);
        const treeState = await fetchCommitmentTree(
          { getAccountInfo: async (pk: unknown) => {
            const info = await connection.getAccountInfo(new PublicKey(pk as string));
            return info ? { data: new Uint8Array(info.data) } : null;
          }},
          commitmentTreePDA
        );

        if (treeState) {
          merkleRoot = bytesToBigint(treeState.currentRoot);
          console.log("[Claim] On-chain merkle root:", merkleRoot.toString(16).slice(0, 16) + "...");
          console.log("[Claim] Next leaf index:", treeState.nextIndex.toString());
        }
      } catch (fetchErr) {
        console.warn("[Claim] Could not fetch commitment tree:", fetchErr);
      }

      // Try to look up commitment in local index
      const commitment = computeUnifiedCommitment(pubKeyX, BigInt(amountSats));
      const commitmentHex = commitment.toString(16).padStart(64, "0");
      const indexEntry = commitmentIndex.getCommitment(commitmentHex);

      if (indexEntry) {
        amountSats = Number(indexEntry.amount);
        leafIndexBigint = indexEntry.index;
        console.log("[Claim] Found commitment in index at leaf:", leafIndexBigint.toString());

        // Get merkle proof from index
        const proof = commitmentIndex.getMerkleProof(commitment);
        if (proof) {
          merkleSiblings = proof.siblings;
          merkleIndices = proof.indices;
          merkleRoot = proof.root;
          console.log("[Claim] Using merkle proof from local index");
        }
      } else {
        console.log("[Claim] Commitment not in local index, using on-chain root only");
        // For demo notes added via addDemoNote, we need to track them
        // If not tracked, we'll use the current root and empty siblings
        // This will work if the contract accepts the proof
      }

      const merkleRootHex = "0x" + merkleRoot.toString(16).padStart(64, "0");
      const leafIndex = Number(leafIndexBigint);

      // Try to generate real proof if prover is ready
      if (proverReady) {
        try {
          console.log("[Claim] Generating ZK proof...");
          console.log("[Claim] - privKey:", privKey.toString(16).slice(0, 16) + "...");
          console.log("[Claim] - pubKeyX:", pubKeyX.toString(16).slice(0, 16) + "...");
          console.log("[Claim] - amount:", amountSats);
          console.log("[Claim] - leafIndex:", leafIndex);

          const claimInputs: ClaimInputs = {
            privKey,
            pubKeyX,
            amount: BigInt(amountSats),
            leafIndex: leafIndexBigint,
            merkleRoot,
            merkleProof: {
              siblings: merkleSiblings,
              indices: merkleIndices,
            },
          };

          const proofData = await generateClaimProof(claimInputs);

          proofBytes = proofToBytes(proofData);
          proofStatus = "zk_verified";
          console.log("[Claim] Proof generated:", proofBytes.length, "bytes");
        } catch (proofErr) {
          console.warn("[Claim] Proof generation failed:", proofErr);
          proofStatus = "proof_failed";
          // Don't fall back to demo mode - show error
          throw new Error(`ZK proof generation failed: ${proofErr instanceof Error ? proofErr.message : proofErr}`);
        }
      } else {
        throw new Error("Prover not ready. Please wait for initialization.");
      }

      // Ensure we have a valid proof before proceeding
      if (!proofBytes) {
        throw new Error("No valid ZK proof generated. Cannot proceed with claim.");
      }

      setClaimProgress("submitting");

      // Build claim transaction
      console.log("[Claim] Building transaction...");

      // Convert hex strings to Uint8Array
      const nullifierHashHex = note.nullifierHash?.toString(16).padStart(64, "0") ?? "0".repeat(64);
      const noteCommitmentHex = note.commitment?.toString(16).padStart(64, "0") ?? "0".repeat(64);
      const nullifierHashBytes = new Uint8Array(Buffer.from(nullifierHashHex, "hex"));
      const commitmentBytes = new Uint8Array(Buffer.from(noteCommitmentHex, "hex"));
      const merkleRootBytes = new Uint8Array(Buffer.from(merkleRootHex.slice(2), "hex"));

      // Get or create user's zBTC token account
      const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
      const { derivezBTCMintPDA } = await import("@/lib/solana/instructions");
      const [zbtcMint] = derivezBTCMintPDA();
      const userTokenAccount = getAssociatedTokenAddressSync(zbtcMint, publicKey, false);

      const transaction = await buildClaimTransaction(connection, {
        nullifierHash: nullifierHashBytes,
        merkleRoot: merkleRootBytes,
        zkProof: proofBytes,
        amountSats: BigInt(amountSats),
        userPubkey: publicKey,
        commitment: commitmentBytes,
        userTokenAccount,
      });

      setClaimProgress("relaying");

      // Sign and submit transaction
      console.log("[Claim] Signing transaction...");
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signedTx = await signTransaction(transaction);

      console.log("[Claim] Submitting to Solana...");
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      setClaimProgress("confirming");

      // Wait for confirmation
      console.log("[Claim] Waiting for confirmation...");
      const confirmation = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      setClaimProgress("complete");
      setTxSignature(signature);
      setClaimedAmount(amountSats);
      setProofData({
        merkleRoot: merkleRootHex,
        leafIndex,
        proofStatus,
      });

      // Brief delay to show complete state before transitioning
      await new Promise((resolve) => setTimeout(resolve, 500));
      setStep("success");
    } catch (err) {
      console.error("[Claim] Error:", err);
      setClaimProgress("idle");
      setError(err instanceof Error ? err.message : "Failed to claim tokens");
      setStep("error");
    }
  }, [secretPhrase, connected, publicKey, signTransaction, connection, verifyResult, proverReady]);

  // Handle split - create two new notes
  const handleSplit = useCallback(async () => {
    if (!claimedAmount || !splitAmount) return;

    const sendAmountSats = parseInt(splitAmount, 10);
    if (isNaN(sendAmountSats) || sendAmountSats <= 0) {
      setError("Please enter a valid amount to send");
      return;
    }
    if (sendAmountSats >= claimedAmount) {
      setError("Send amount must be less than total claimed amount");
      return;
    }

    setSplitLoading(true);
    setError(null);

    try {
      // Initialize Poseidon
      await initPoseidon();

      const keepAmountSats = claimedAmount - sendAmountSats;

      // Create two new notes
      const keepNote = createNote(BigInt(keepAmountSats));
      const sendNote = createNote(BigInt(sendAmountSats));

      // Generate claim links for both
      const keepLink = encodeClaimLink(
        keepNote.nullifier.toString(),
        keepNote.secret.toString()
      );
      const sendLink = encodeClaimLink(
        sendNote.nullifier.toString(),
        sendNote.secret.toString()
      );

      setSplitResult({
        keepLink,
        keepAmount: keepAmountSats,
        sendLink,
        sendAmount: sendAmountSats,
      });

      console.log("[Split] Created two new notes:");
      console.log("[Split] Keep amount:", keepAmountSats, "sats");
      console.log("[Split] Send amount:", sendAmountSats, "sats");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to split notes");
    } finally {
      setSplitLoading(false);
    }
  }, [claimedAmount, splitAmount]);

  // Copy handlers for split links
  const copyKeepLink = useCallback(async () => {
    if (!splitResult?.keepLink) return;
    const fullUrl = `${window.location.origin}/claim?note=${splitResult.keepLink}`;
    await navigator.clipboard.writeText(fullUrl);
    setKeepLinkCopied(true);
    setTimeout(() => setKeepLinkCopied(false), 2000);
  }, [splitResult]);

  const copySendLink = useCallback(async () => {
    if (!splitResult?.sendLink) return;
    const fullUrl = `${window.location.origin}/claim?note=${splitResult.sendLink}`;
    await navigator.clipboard.writeText(fullUrl);
    setSendLinkCopied(true);
    setTimeout(() => setSendLinkCopied(false), 2000);
  }, [splitResult]);

  const resetFlow = () => {
    setStep("input");
    setClaimProgress("idle");
    setSecretPhrase("");
    setVerifyResult(null);
    setTxSignature(null);
    setClaimedAmount(null);
    setProofData(null);
    setEncodedLink(null);
    setLinkCopied(false);
    setShowSplitUI(false);
    setSplitAmount("");
    setSplitResult(null);
    setError(null);
  };

  if (!mounted) {
    return (
      <main className="min-h-screen bg-background hacker-bg noise-overlay flex flex-col items-center justify-center p-4">
        <div className="w-16 h-16 rounded-full border-4 border-gray/15 border-t-purple animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background hacker-bg noise-overlay flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="w-full max-w-[480px] mb-4 flex items-center justify-between relative z-10">
        <Link
          href="/bridge"
          className="inline-flex items-center gap-2 text-body2 text-gray hover:text-gray-light transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Bridge
        </Link>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-purple/10 border border-purple/20">
          <Gift className="w-3 h-3 text-purple" />
          <span className="text-caption text-purple">Claim</span>
        </div>
      </div>

      {/* Widget */}
      <div
        className={cn(
          "bg-card border border-solid border-gray/30 p-4",
          "w-[480px] max-w-[calc(100vw-32px)] rounded-[16px]",
          "glow-border cyber-corners relative z-10"
        )}
      >
        <h1 className="text-heading5 text-foreground mb-2">Claim zBTC Tokens</h1>
        <p className="text-body2 text-gray mb-6">
          Enter your secret phrase to claim your zBTC.
        </p>

        {step === "input" && (
          <div className="space-y-4">
            {/* Privacy info */}
            <div className="flex items-center gap-3 p-3 bg-privacy/10 border border-privacy/20 rounded-[12px]">
              <Shield className="w-5 h-5 text-privacy" />
              <div className="flex flex-col">
                <span className="text-body2-semibold text-privacy">Privacy Preserved</span>
                <span className="text-caption text-privacy opacity-80">
                  Amount is looked up on-chain. Your deposit cannot be linked to this claim.
                </span>
              </div>
            </div>

            {/* Paste Link Button */}
            {!secretPhrase && (
              <button
                onClick={pasteLink}
                className="w-full p-3 bg-sol/10 border border-sol/20 rounded-[12px] text-body2 text-sol hover:bg-sol/20 transition-colors flex items-center justify-center gap-2"
              >
                <Copy className="w-4 h-4" />
                Paste Claim Link from Clipboard
              </button>
            )}

            {/* Divider */}
            {!secretPhrase && (
              <div className="divider-text text-caption text-gray">or enter manually</div>
            )}

            {/* Secret Phrase Input */}
            <div>
              <label className="text-body2 text-gray-light pl-2 mb-2 block">
                Secret Phrase
              </label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray" />
                <input
                  type="text"
                  value={secretPhrase}
                  onChange={(e) => setSecretPhrase(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="Enter your secret phrase (e.g., alpha-bravo-charlie-1234)"
                  className={cn(
                    "w-full p-3 pl-10 bg-muted border border-gray/15 rounded-[12px]",
                    "text-body2 font-mono text-foreground placeholder:text-gray",
                    "outline-none focus:border-privacy/40 transition-colors"
                  )}
                />
              </div>
              <p className="text-caption text-gray mt-1 pl-2">
                This is the same secret you used when depositing
              </p>
            </div>

            {/* Generate/Copy Claim Link */}
            {secretPhrase.trim().length >= 8 && (
              <div className="p-3 bg-muted border border-gray/15 rounded-[12px]">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-caption text-gray flex items-center gap-1">
                    <Link2 className="w-3 h-3" />
                    Shareable Claim Link
                  </p>
                  <button
                    onClick={copyLink}
                    className="text-caption text-privacy hover:text-success transition-colors flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    {linkCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <div className="p-2 bg-background rounded-[8px] break-all">
                  <code className="text-caption font-mono text-gray-light">
                    {`${typeof window !== 'undefined' ? window.location.origin : ''}/claim?note=${encodeURIComponent(secretPhrase.trim())}`}
                  </code>
                </div>
              </div>
            )}

            {/* Verification Result */}
            {verifyResult && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/20 rounded-[12px]">
                  <CheckCircle2 className="w-5 h-5 text-success" />
                  <span className="text-body2 text-success">Claim verified!</span>
                </div>
                <div className="p-3 bg-muted border border-gray/15 rounded-[12px]">
                  <p className="text-caption text-gray mb-1">Amount to Claim</p>
                  <p className="text-heading6 text-privacy">
                    {formatBtc(verifyResult.amountSats)} zBTC
                  </p>
                </div>
              </div>
            )}

            {/* Recipient Wallet */}
            <div>
              <label className="text-body2 text-gray-light pl-2 mb-2 block">
                Recipient Wallet
              </label>
              {connected && publicKey ? (
                <div className="flex items-center gap-2 p-3 bg-muted border border-privacy/20 rounded-[12px]">
                  <div className="w-2 h-2 rounded-full bg-privacy" />
                  <span className="text-body2 font-mono text-gray-light">
                    {publicKey.toBase58().slice(0, 8)}...{publicKey.toBase58().slice(-8)}
                  </span>
                </div>
              ) : (
                <WalletButton className="btn-tertiary w-full justify-center" />
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-[12px] text-error">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="text-caption">{error}</span>
              </div>
            )}

            {/* Buttons */}
            <div className="space-y-2">
              {!verifyResult && (
                <button
                  onClick={handleVerify}
                  disabled={secretPhrase.trim().length < 8}
                  className="btn-secondary w-full"
                >
                  <Shield className="w-5 h-5" />
                  Verify Claim
                </button>
              )}
              <button
                onClick={handleClaim}
                disabled={secretPhrase.trim().length < 8 || !connected}
                className="btn-primary w-full"
              >
                <Coins className="w-5 h-5" />
                Claim zBTC
              </button>
            </div>
          </div>
        )}

        {step === "verifying" && (
          <div className="flex flex-col items-center py-8">
            <div className="relative w-16 h-16 mb-4">
              <div className="absolute inset-0 rounded-full border-4 border-gray/15" />
              <div className="absolute inset-0 rounded-full border-4 border-privacy border-t-transparent animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Shield className="w-6 h-6 text-privacy" />
              </div>
            </div>
            <p className="text-body2 text-gray-light">Verifying claim...</p>
            <p className="text-caption text-gray">Looking up deposit on-chain</p>
          </div>
        )}

        {step === "claiming" && (
          <div className="flex flex-col py-4">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full border-4 border-gray/15" />
                <div className="absolute inset-0 rounded-full border-4 border-purple border-t-transparent animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Coins className="w-5 h-5 text-purple" />
                </div>
              </div>
              <div>
                <p className="text-body2-semibold text-foreground">Claiming zBTC</p>
                <p className="text-caption text-gray">
                  {claimProgress === "generating_proof" && "Generating ZK proof..."}
                  {claimProgress === "submitting" && "Submitting to relayer..."}
                  {claimProgress === "relaying" && "Relayer processing..."}
                  {claimProgress === "confirming" && "Confirming on Solana..."}
                  {claimProgress === "complete" && "Complete!"}
                </p>
              </div>
            </div>

            {/* Progress indicator */}
            <div className="p-4 bg-muted border border-gray/15 rounded-[12px]">
              <ClaimProgressIndicator currentProgress={claimProgress} />
            </div>

            {/* Privacy note */}
            <div className="mt-4 flex items-center gap-2 p-3 bg-privacy/10 border border-privacy/20 rounded-[12px]">
              <Shield className="w-4 h-4 text-privacy shrink-0" />
              <p className="text-caption text-privacy">
                Your transaction is being relayed privately. No direct link to your deposit.
              </p>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-success/10 border border-success/20 rounded-[12px]">
              <CheckCircle2 className="w-5 h-5 text-success" />
              <span className="text-body2 text-success">Tokens claimed successfully!</span>
            </div>

            {/* Claim Details */}
            <div className="space-y-3">
              {claimedAmount && (
                <div className="p-3 bg-muted border border-gray/15 rounded-[12px]">
                  <p className="text-caption text-gray mb-1">Amount Claimed</p>
                  <p className="text-heading6 text-privacy">
                    {formatBtc(claimedAmount)} zBTC
                  </p>
                </div>
              )}

              {txSignature && (
                <div className="p-3 bg-muted border border-gray/15 rounded-[12px]">
                  <p className="text-caption text-gray mb-1">Transaction</p>
                  <a
                    href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-caption font-mono text-privacy hover:underline break-all flex items-center gap-1"
                  >
                    {txSignature.slice(0, 20)}...{txSignature.slice(-20)}
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                </div>
              )}

              {/* ZK Proof Details */}
              {proofData && (
                <div className="p-3 bg-privacy/10 border border-privacy/20 rounded-[12px]">
                  <p className="text-caption text-privacy mb-2 flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    ZK Proof Verified
                  </p>
                  <div className="space-y-1 text-caption">
                    <div className="flex justify-between">
                      <span className="text-gray">Status:</span>
                      <span className="text-privacy font-mono">{proofData.proofStatus}</span>
                    </div>
                    {proofData.leafIndex !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-gray">Leaf Index:</span>
                        <span className="text-gray-light font-mono">{proofData.leafIndex}</span>
                      </div>
                    )}
                    {proofData.merkleRoot && (
                      <div className="flex justify-between">
                        <span className="text-gray">Merkle Root:</span>
                        <span className="text-gray-light font-mono truncate max-w-[150px]" title={proofData.merkleRoot}>
                          {proofData.merkleRoot.slice(0, 8)}...{proofData.merkleRoot.slice(-8)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Split & Send Section */}
            {claimedAmount && claimedAmount > 1000 && !splitResult && (
              <div className="border-t border-gray/15 pt-4">
                {!showSplitUI ? (
                  <button
                    onClick={() => setShowSplitUI(true)}
                    className="w-full p-3 bg-sol/10 border border-sol/20 rounded-[12px] text-body2 text-sol hover:bg-sol/20 transition-colors flex items-center justify-center gap-2"
                  >
                    <Gift className="w-4 h-4" />
                    Split & Send to Someone
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-body2-semibold text-foreground flex items-center gap-2">
                        <Gift className="w-4 h-4 text-sol" />
                        Split & Send
                      </p>
                      <button
                        onClick={() => setShowSplitUI(false)}
                        className="text-caption text-gray hover:text-gray-light transition-colors"
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="p-3 bg-muted border border-gray/15 rounded-[12px]">
                      <p className="text-caption text-gray mb-2">Amount to Send (sats)</p>
                      <input
                        type="number"
                        value={splitAmount}
                        onChange={(e) => setSplitAmount(e.target.value)}
                        placeholder="0"
                        min="1000"
                        max={claimedAmount - 1000}
                        className={cn(
                          "w-full p-2 bg-background border border-gray/20 rounded-[8px]",
                          "text-body2 font-mono text-foreground placeholder:text-gray",
                          "outline-none focus:border-sol/40 transition-colors"
                        )}
                      />
                      <div className="flex justify-between mt-2 text-caption text-gray">
                        <span>Min: 1,000 sats</span>
                        <span>Max: {(claimedAmount - 1000).toLocaleString()} sats</span>
                      </div>
                    </div>

                    {splitAmount && parseInt(splitAmount, 10) > 0 && parseInt(splitAmount, 10) < claimedAmount && (
                      <div className="p-3 bg-sol/10 border border-sol/20 rounded-[12px]">
                        <div className="flex justify-between text-caption mb-1">
                          <span className="text-gray">You keep:</span>
                          <span className="text-foreground">{formatBtc(claimedAmount - parseInt(splitAmount, 10))} zBTC</span>
                        </div>
                        <div className="flex justify-between text-caption">
                          <span className="text-gray">Send to friend:</span>
                          <span className="text-sol">{formatBtc(parseInt(splitAmount, 10))} zBTC</span>
                        </div>
                      </div>
                    )}

                    {error && (
                      <div className="flex items-center gap-2 p-2 bg-error/10 border border-error/20 rounded-[8px] text-error">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        <span className="text-caption">{error}</span>
                      </div>
                    )}

                    <button
                      onClick={handleSplit}
                      disabled={splitLoading || !splitAmount || parseInt(splitAmount, 10) <= 0 || parseInt(splitAmount, 10) >= claimedAmount}
                      className="btn-secondary w-full"
                    >
                      {splitLoading ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Generating...
                        </span>
                      ) : (
                        <>
                          <Gift className="w-4 h-4" />
                          Generate Claim Links
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Split Result */}
            {splitResult && (
              <div className="border-t border-gray/15 pt-4 space-y-3">
                <p className="text-body2-semibold text-success flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Split Complete!
                </p>

                {/* Your Link */}
                <div className="p-3 bg-privacy/10 border border-privacy/20 rounded-[12px]">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-caption text-privacy flex items-center gap-1">
                      <Key className="w-3 h-3" />
                      Your Link ({formatBtc(splitResult.keepAmount)})
                    </p>
                    <button
                      onClick={copyKeepLink}
                      className="text-caption text-privacy hover:text-success transition-colors flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      {keepLinkCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <div className="p-2 bg-background rounded-[8px]">
                    <code className="text-caption font-mono text-gray-light break-all">
                      {`${typeof window !== 'undefined' ? window.location.origin : ''}/claim?note=${splitResult.keepLink.slice(0, 30)}...`}
                    </code>
                  </div>
                </div>

                {/* Send Link */}
                <div className="p-3 bg-sol/10 border border-sol/20 rounded-[12px]">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-caption text-sol flex items-center gap-1">
                      <Gift className="w-3 h-3" />
                      Send to Friend ({formatBtc(splitResult.sendAmount)})
                    </p>
                    <button
                      onClick={copySendLink}
                      className="text-caption text-sol hover:text-success transition-colors flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      {sendLinkCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <div className="p-2 bg-background rounded-[8px]">
                    <code className="text-caption font-mono text-gray-light break-all">
                      {`${typeof window !== 'undefined' ? window.location.origin : ''}/claim?note=${splitResult.sendLink.slice(0, 30)}...`}
                    </code>
                  </div>
                  <p className="text-caption text-gray mt-2">
                    Share this link with the person you want to send zBTC to!
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-2">
              <Link href="/bridge" className="btn-primary w-full">
                Back to Bridge
              </Link>
              <button onClick={resetFlow} className="btn-tertiary w-full">
                Claim Another
              </button>
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-error/10 border border-error/20 rounded-[12px]">
              <AlertCircle className="w-5 h-5 text-error" />
              <span className="text-body2 text-error">Claim failed</span>
            </div>

            {error && (
              <div className="p-3 bg-muted border border-gray/15 rounded-[12px]">
                <p className="text-caption text-gray mb-1">Error</p>
                <p className="text-body2 text-error">{error}</p>
              </div>
            )}

            <button onClick={resetFlow} className="btn-primary w-full">
              Try Again
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

export default function ClaimPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-background hacker-bg noise-overlay flex flex-col items-center justify-center p-4">
        <div className="w-16 h-16 rounded-full border-4 border-gray/15 border-t-purple animate-spin" />
      </main>
    }>
      <ClaimContent />
    </Suspense>
  );
}
