"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Search, Shield, CheckCircle2, AlertCircle, Copy, Check,
  RefreshCw, ExternalLink, Loader2, Upload
} from "lucide-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { cn } from "@/lib/utils";
import { Spinner, WalletButton } from "@/components/ui";
import { BitcoinIcon } from "@/components/bitcoin-wallet-selector";
import {
  getTransactionInfo,
  getBlockHeader,
  getMerkleProof,
  getTipHeight,
  type BlockHeader,
  type MerkleProof,
  type TransactionInfo,
} from "@/lib/spv/mempool";
import { formatBlockHeaderForChain, formatMerkleProofForChain } from "@/lib/spv/verify";
import { zBTCApi } from "@/lib/api/client";

interface VerificationData {
  txInfo: TransactionInfo;
  blockHeader: BlockHeader;
  merkleProof: MerkleProof;
  confirmations: number;
}

export function ManualVerify() {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();

  // Input state
  const [taprootAddress, setTaprootAddress] = useState("");
  const [txid, setTxid] = useState("");

  // Verification state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationData, setVerificationData] = useState<VerificationData | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Block header submission state
  const [headerSubmitting, setHeaderSubmitting] = useState(false);
  const [headerSubmitted, setHeaderSubmitted] = useState(false);
  const [headerTxSig, setHeaderTxSig] = useState<string | null>(null);

  // Fetch transaction info by address
  const handleLookupAddress = useCallback(async () => {
    if (!taprootAddress.trim()) {
      setError("Please enter a taproot address");
      return;
    }

    setLoading(true);
    setError(null);
    setVerificationData(null);

    try {
      // Fetch transactions for address from mempool.space
      const response = await fetch(
        `https://mempool.space/testnet/api/address/${taprootAddress}/txs`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch address transactions");
      }

      const txs = await response.json();

      if (txs.length === 0) {
        setError("No transactions found for this address");
        return;
      }

      // Find incoming transaction (deposit)
      let depositTxid: string | null = null;
      for (const tx of txs) {
        for (const vout of tx.vout) {
          if (vout.scriptpubkey_address === taprootAddress) {
            depositTxid = tx.txid;
            break;
          }
        }
        if (depositTxid) break;
      }

      if (!depositTxid) {
        setError("No deposit transaction found");
        return;
      }

      setTxid(depositTxid);
      await fetchVerificationData(depositTxid);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, [taprootAddress]);

  // Fetch verification data by txid
  const handleLookupTxid = useCallback(async () => {
    if (!txid.trim()) {
      setError("Please enter a transaction ID");
      return;
    }

    setLoading(true);
    setError(null);
    await fetchVerificationData(txid.trim());
    setLoading(false);
  }, [txid]);

  // Core function to fetch all verification data
  const fetchVerificationData = async (transactionId: string) => {
    try {
      console.log("[Verify] Fetching data for txid:", transactionId);

      // Get transaction info
      const txInfo = await getTransactionInfo(transactionId, "testnet");

      if (!txInfo.confirmed || !txInfo.blockHash) {
        setError("Transaction not confirmed yet");
        return;
      }

      // Get block header
      const blockHeader = await getBlockHeader(txInfo.blockHash, "testnet");

      // Get merkle proof
      const merkleProof = await getMerkleProof(transactionId, "testnet");
      merkleProof.blockHash = txInfo.blockHash;

      // Get confirmations
      const tipHeight = await getTipHeight("testnet");
      const confirmations = tipHeight - txInfo.blockHeight! + 1;

      setVerificationData({
        txInfo,
        blockHeader,
        merkleProof,
        confirmations,
      });

      console.log("[Verify] Data fetched:", {
        blockHeight: blockHeader.height,
        confirmations,
        merkleProofLength: merkleProof.merkleProof.length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch verification data");
    }
  };

  // Copy to clipboard
  const copyToClipboard = useCallback(async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  // Submit block header to Solana via relayer
  const handleSubmitBlockHeader = useCallback(async () => {
    if (!verificationData) {
      setError("No verification data");
      return;
    }

    setHeaderSubmitting(true);
    setError(null);

    try {
      const header = verificationData.blockHeader;
      console.log("[Header] Submitting block header via relayer...");
      console.log("[Header] Height:", header.height);
      console.log("[Header] Hash:", header.hash);

      // Call relayer API to publish header on-chain
      const result = await zBTCApi.submitHeader(
        header.height,
        header.hash,
        header.rawHeader,
        header.previousBlockHash,
        header.merkleRoot,
        header.timestamp,
        header.bits,
        header.nonce
      );

      if (result.success) {
        setHeaderTxSig(result.solana_tx_signature || null);
        setHeaderSubmitted(true);
        console.log("[Header] Block header submitted:", result.solana_tx_signature);

        if (result.already_exists) {
          console.log("[Header] Header already existed on-chain");
        }
      } else {
        throw new Error(result.error || result.message || "Failed to submit header");
      }
    } catch (err) {
      console.error("[Header] Submission failed:", err);
      setError(err instanceof Error ? err.message : "Failed to submit block header");
    } finally {
      setHeaderSubmitting(false);
    }
  }, [verificationData]);

  // Format data for display
  const getFormattedHeaderData = () => {
    if (!verificationData) return null;
    return formatBlockHeaderForChain(verificationData.blockHeader);
  };

  const getFormattedProofData = () => {
    if (!verificationData || !txid) return null;
    return formatMerkleProofForChain(txid, verificationData.merkleProof);
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-[10px] bg-[#14F1951A] border border-[#14F19533]">
          <Shield className="w-5 h-5 text-[#14F195]" />
        </div>
        <div>
          <p className="text-body2-semibold text-[#FFFFFF]">Manual SPV Verification</p>
          <p className="text-caption text-[#8B8A9E]">Verify Bitcoin deposit with block header</p>
        </div>
      </div>

      {/* Input Section */}
      <div className="space-y-4 mb-4">
        {/* Taproot Address Input */}
        <div>
          <label className="text-body2 text-[#C7C5D1] pl-2 mb-2 block">
            Taproot Address
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={taprootAddress}
              onChange={(e) => setTaprootAddress(e.target.value)}
              placeholder="tb1p..."
              className={cn(
                "flex-1 p-3 bg-[#16161B] border border-[#8B8A9E26] rounded-[12px]",
                "text-body2 font-mono text-[#F1F0F3] placeholder:text-[#8B8A9E]",
                "outline-none focus:border-[#14F19566] transition-colors"
              )}
            />
            <button
              onClick={handleLookupAddress}
              disabled={loading || !taprootAddress.trim()}
              className="btn-tertiary px-4"
            >
              {loading ? <Spinner /> : <Search className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* OR divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[#8B8A9E26]" />
          <span className="text-caption text-[#8B8A9E]">OR</span>
          <div className="flex-1 h-px bg-[#8B8A9E26]" />
        </div>

        {/* Transaction ID Input */}
        <div>
          <label className="text-body2 text-[#C7C5D1] pl-2 mb-2 block">
            Transaction ID
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={txid}
              onChange={(e) => setTxid(e.target.value)}
              placeholder="64-character hex txid"
              className={cn(
                "flex-1 p-3 bg-[#16161B] border border-[#8B8A9E26] rounded-[12px]",
                "text-body2 font-mono text-[#F1F0F3] placeholder:text-[#8B8A9E]",
                "outline-none focus:border-[#14F19566] transition-colors"
              )}
            />
            <button
              onClick={handleLookupTxid}
              disabled={loading || !txid.trim()}
              className="btn-tertiary px-4"
            >
              {loading ? <Spinner /> : <Search className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="warning-box mb-4">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Verification Data Display */}
      {verificationData && (
        <div className="space-y-4">
          {/* Transaction Info */}
          <div className="gradient-bg-card p-4 rounded-[12px] border border-[#4ADE8033]">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-[#4ADE80]" />
              <span className="text-body2-semibold text-[#4ADE80]">Transaction Found</span>
            </div>
            <div className="space-y-2 text-caption">
              <div className="flex justify-between">
                <span className="text-[#8B8A9E]">TXID</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[#C7C5D1]">
                    {txid.slice(0, 8)}...{txid.slice(-8)}
                  </span>
                  <button
                    onClick={() => copyToClipboard(txid, "txid")}
                    className="p-1 hover:bg-[#8B8A9E1A] rounded"
                  >
                    {copied === "txid" ? (
                      <Check className="w-3 h-3 text-[#4ADE80]" />
                    ) : (
                      <Copy className="w-3 h-3 text-[#8B8A9E]" />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8B8A9E]">Confirmations</span>
                <span className="font-mono text-[#14F195]">{verificationData.confirmations}</span>
              </div>
            </div>
          </div>

          {/* Block Header */}
          <div className="gradient-bg-card p-4 rounded-[12px]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-body2-semibold text-[#F7931A]">Block Header</span>
              <button
                onClick={() => copyToClipboard(verificationData.blockHeader.rawHeader, "header")}
                className="p-1.5 rounded-[6px] bg-[#F7931A1A] hover:bg-[#F7931A33] transition-colors"
              >
                {copied === "header" ? (
                  <Check className="w-3.5 h-3.5 text-[#4ADE80]" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[#F7931A]" />
                )}
              </button>
            </div>
            <div className="space-y-2 text-caption">
              <div className="flex justify-between">
                <span className="text-[#8B8A9E]">Height</span>
                <span className="font-mono text-[#C7C5D1]">
                  {verificationData.blockHeader.height.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8B8A9E]">Hash</span>
                <span className="font-mono text-[#C7C5D1]">
                  {verificationData.blockHeader.hash.slice(0, 12)}...
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8B8A9E]">Timestamp</span>
                <span className="font-mono text-[#C7C5D1]">
                  {new Date(verificationData.blockHeader.timestamp * 1000).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8B8A9E]">Merkle Root</span>
                <span className="font-mono text-[#C7C5D1]">
                  {verificationData.blockHeader.merkleRoot.slice(0, 12)}...
                </span>
              </div>
            </div>
            {/* Raw header */}
            <div className="mt-3 p-2 bg-[#0F0F12] rounded-[8px]">
              <p className="text-caption text-[#8B8A9E] mb-1">Raw Header (80 bytes)</p>
              <code className="text-[10px] font-mono text-[#C7C5D1] break-all block">
                {verificationData.blockHeader.rawHeader}
              </code>
            </div>

            {/* Submit Block Header Button */}
            <div className="mt-3">
              {headerSubmitted ? (
                <div className="flex items-center gap-2 p-2 bg-[#4ADE801A] border border-[#4ADE8033] rounded-[8px]">
                  <CheckCircle2 className="w-4 h-4 text-[#4ADE80]" />
                  <span className="text-caption text-[#4ADE80]">Header on Solana</span>
                  {headerTxSig && (
                    <a
                      href={`https://explorer.solana.com/tx/${headerTxSig}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-mono text-[#14F195] ml-auto hover:underline"
                    >
                      {headerTxSig.slice(0, 12)}...
                    </a>
                  )}
                </div>
              ) : (
                <button
                  onClick={handleSubmitBlockHeader}
                  disabled={headerSubmitting}
                  className="btn-bitcoin w-full text-sm py-2"
                >
                  {headerSubmitting ? (
                    <span className="flex items-center gap-2">
                      <Spinner />
                      Submitting via Relayer...
                    </span>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Submit Header to Solana
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Merkle Proof */}
          <div className="gradient-bg-card p-4 rounded-[12px]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-body2-semibold text-[#14F195]">Merkle Proof</span>
              <button
                onClick={() => copyToClipboard(
                  JSON.stringify(verificationData.merkleProof.merkleProof, null, 2),
                  "merkle"
                )}
                className="p-1.5 rounded-[6px] bg-[#14F1951A] hover:bg-[#14F19533] transition-colors"
              >
                {copied === "merkle" ? (
                  <Check className="w-3.5 h-3.5 text-[#4ADE80]" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[#14F195]" />
                )}
              </button>
            </div>
            <div className="space-y-2 text-caption">
              <div className="flex justify-between">
                <span className="text-[#8B8A9E]">TX Index</span>
                <span className="font-mono text-[#C7C5D1]">{verificationData.merkleProof.txIndex}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8B8A9E]">Proof Length</span>
                <span className="font-mono text-[#C7C5D1]">
                  {verificationData.merkleProof.merkleProof.length} siblings
                </span>
              </div>
            </div>
            {/* Merkle siblings */}
            <div className="mt-3 p-2 bg-[#0F0F12] rounded-[8px] max-h-32 overflow-y-auto">
              <p className="text-caption text-[#8B8A9E] mb-1">Siblings (SHA256)</p>
              {verificationData.merkleProof.merkleProof.map((hash, i) => (
                <code key={i} className="text-[10px] font-mono text-[#C7C5D1] block">
                  [{i}] {hash}
                </code>
              ))}
            </div>
          </div>

          {/* View on Explorer */}
          <div className="flex gap-2">
            <a
              href={`https://mempool.space/testnet/tx/${txid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-tertiary flex-1 justify-center"
            >
              View TX <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={`https://mempool.space/testnet/block/${verificationData.blockHeader.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-tertiary flex-1 justify-center"
            >
              View Block <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Submit to Solana */}
          {connected ? (
            <button className="btn-primary w-full" disabled>
              <Shield className="w-5 h-5" />
              Submit to Solana (Coming Soon)
            </button>
          ) : (
            <WalletButton className="btn-primary w-full justify-center" />
          )}
        </div>
      )}

      {/* Empty state */}
      {!verificationData && !loading && !error && (
        <div className="text-center py-8 text-[#8B8A9E]">
          <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-body2">Enter an address or txid to fetch verification data</p>
        </div>
      )}
    </div>
  );
}
