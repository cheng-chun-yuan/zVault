"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Connection } from "@solana/web3.js";
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  QrCode,
  Send,
  Wallet,
  Key,
  RefreshCw,
  User,
  Tag,
  Inbox,
  Loader2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/utils";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useZVaultKeys } from "@/hooks/use-zvault";
import { useStealthInbox } from "@/hooks/use-zvault";
import {
  decodeStealthMetaAddress,
  createStealthDeposit,
  deriveTaprootAddress,
  lookupZkeyName,
  type StealthMetaAddress,
  type StealthDeposit,
} from "@zvault/sdk";

interface DepositData {
  taprootAddress: string;
  stealthDeposit: StealthDeposit;
  recipientAddress: string;
  amountSats: bigint;
}

export function StealthSendFlow() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const { keys, deriveKeys, isLoading: keysLoading } = useZVaultKeys();
  const { copied, copy } = useCopyToClipboard();
  const { totalAmountSats, depositCount, isLoading: inboxLoading } = useStealthInbox();

  // Form state
  const [recipientInput, setRecipientInput] = useState("");
  const [amountBtc, setAmountBtc] = useState("");
  const [showQR, setShowQR] = useState(false);

  // Process state
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositData, setDepositData] = useState<DepositData | null>(null);
  const [resolvedMeta, setResolvedMeta] = useState<StealthMetaAddress | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(null);

  const amountSats = amountBtc ? BigInt(Math.floor(parseFloat(amountBtc) * 100_000_000)) : 0n;
  const isValidAmount = amountSats > 0n && amountSats <= 21_000_000n * 100_000_000n;

  // Resolve recipient - supports both zkey names and raw hex addresses
  const resolveRecipient = useCallback(async () => {
    const input = recipientInput.trim();
    if (!input) return;

    setResolving(true);
    setError(null);
    setResolvedMeta(null);
    setResolvedName(null);

    try {
      // Check if it looks like hex (long, only hex chars)
      const isLikelyHex = /^[0-9a-fA-F]{100,}$/.test(input);

      if (isLikelyHex) {
        // Try to decode as hex stealth address
        const meta = decodeStealthMetaAddress(input);
        if (meta) {
          setResolvedMeta(meta);
          return;
        }
        setError("Invalid stealth address format (expected 130 hex characters)");
      } else {
        // Try as zkey name
        const name = input.replace(/\.zkey$/i, "");
        const connection = new Connection(
          process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com"
        );
        const connectionAdapter = {
          getAccountInfo: async (pubkey: { toBytes(): Uint8Array }) => {
            const { PublicKey } = await import("@solana/web3.js");
            const pk = new PublicKey(pubkey.toBytes());
            const info = await connection.getAccountInfo(pk);
            return info ? { data: new Uint8Array(info.data) } : null;
          },
        };
        const result = await lookupZkeyName(connectionAdapter, name);
        if (result) {
          setResolvedMeta({
            spendingPubKey: result.spendingPubKey,
            viewingPubKey: result.viewingPubKey,
          });
          setResolvedName(name);
          return;
        }
        // If zkey lookup fails, try as hex one more time
        const meta = decodeStealthMetaAddress(input);
        if (meta) {
          setResolvedMeta(meta);
          return;
        }
        setError(`"${name}.zkey" not found`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve recipient");
    } finally {
      setResolving(false);
    }
  }, [recipientInput]);

  const handleCreateDeposit = async () => {
    if (!resolvedMeta || !isValidAmount) {
      setError("Please resolve recipient and enter a valid amount");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Create stealth deposit
      const stealthDeposit = await createStealthDeposit(resolvedMeta, amountSats);

      // Generate taproot address from commitment
      const { address } = await deriveTaprootAddress(
        stealthDeposit.commitment,
        "testnet"
      );

      setDepositData({
        taprootAddress: address,
        stealthDeposit,
        recipientAddress: resolvedName ? `${resolvedName}.zkey` : recipientInput.trim(),
        amountSats,
      });
    } catch (err) {
      console.error("Failed to create stealth deposit:", err);
      setError(err instanceof Error ? err.message : "Failed to create stealth deposit");
    } finally {
      setLoading(false);
    }
  };

  const resetFlow = () => {
    setRecipientInput("");
    setAmountBtc("");
    setDepositData(null);
    setResolvedMeta(null);
    setResolvedName(null);
    setError(null);
    setShowQR(false);
  };

  // Not connected
  if (!wallet.connected) {
    return (
      <div className="text-center py-8">
        <p className="text-body2 text-gray mb-4">
          Connect your wallet to send privately
        </p>
        <button
          onClick={() => setVisible(true)}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-[10px]",
            "bg-privacy hover:bg-privacy/80 text-background transition-colors"
          )}
        >
          <Wallet className="w-4 h-4" />
          Connect Wallet
        </button>
      </div>
    );
  }

  // Connected but no keys
  if (!keys) {
    return (
      <div className="text-center py-8">
        <p className="text-body2 text-gray mb-4">
          Sign a message to derive your zVault keys
        </p>
        <button
          onClick={deriveKeys}
          disabled={keysLoading}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-[10px]",
            "bg-privacy hover:bg-privacy/80 disabled:bg-gray/30",
            "text-background disabled:text-gray transition-colors"
          )}
        >
          <Key className="w-4 h-4" />
          {keysLoading ? "Signing..." : "Derive Keys"}
        </button>
      </div>
    );
  }

  // Show deposit result
  if (depositData) {
    const btcAmount = Number(depositData.amountSats) / 100_000_000;

    return (
      <div className="flex flex-col gap-4">
        {/* Success message */}
        <div className="p-3 bg-privacy/10 border border-privacy/20 rounded-[10px]">
          <div className="flex items-center gap-2 text-privacy">
            <Check className="w-4 h-4" />
            <span className="text-body2-semibold">Stealth deposit created</span>
          </div>
        </div>

        {/* Amount */}
        <div className="p-3 bg-muted border border-gray/15 rounded-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-caption text-gray">Amount</span>
            <span className="text-body2 text-btc font-mono">{btcAmount} BTC</span>
          </div>
        </div>

        {/* Recipient */}
        <div className="p-3 bg-muted border border-gray/15 rounded-[10px]">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-3 h-3 text-gray" />
            <span className="text-caption text-gray">Recipient</span>
          </div>
          <code className="text-caption font-mono text-gray-light break-all">
            {depositData.recipientAddress.slice(0, 24)}...{depositData.recipientAddress.slice(-24)}
          </code>
        </div>

        {/* Deposit Address */}
        <div className="p-4 bg-btc/5 border border-btc/20 rounded-[12px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-caption text-btc">Send BTC to this address</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowQR(!showQR)}
                className={cn(
                  "p-1.5 rounded-[6px] transition-colors",
                  showQR ? "bg-btc/20 text-btc" : "bg-btc/10 text-btc hover:bg-btc/20"
                )}
                title={showQR ? "Hide QR" : "Show QR"}
              >
                <QrCode className="w-4 h-4" />
              </button>
              <button
                onClick={() => copy(depositData.taprootAddress)}
                className="p-1.5 rounded-[6px] bg-btc/10 hover:bg-btc/20 transition-colors"
                title="Copy address"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4 text-btc" />
                )}
              </button>
            </div>
          </div>
          <code className="text-body2 font-mono text-btc break-all block">
            {depositData.taprootAddress}
          </code>
        </div>

        {/* QR Code */}
        {showQR && (
          <div className="flex justify-center p-4 bg-white rounded-[12px]">
            <QRCodeSVG
              value={depositData.taprootAddress}
              size={200}
              level="M"
              bgColor="#FFFFFF"
              fgColor="#F7931A"
            />
          </div>
        )}

        {/* Info */}
        <div className="p-3 bg-muted border border-gray/15 rounded-[10px]">
          <p className="text-caption text-gray">
            Send exactly <span className="text-btc font-mono">{btcAmount} BTC</span> to the address above.
            The recipient will be able to claim the funds privately using their stealth address.
          </p>
        </div>

        {/* Testnet faucet */}
        <div className="flex items-center justify-between p-3 bg-muted border border-gray/15 rounded-[10px]">
          <span className="text-caption text-gray">Need testnet BTC?</span>
          <a
            href="https://coinfaucet.eu/en/btc-testnet/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-caption text-btc hover:text-btc/80 transition-colors flex items-center gap-1"
          >
            Get from faucet
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* View on explorer */}
        <a
          href={`https://mempool.space/testnet/address/${depositData.taprootAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex items-center justify-center gap-2 p-3 rounded-[10px]",
            "bg-muted border border-gray/15 text-gray hover:text-gray-light transition-colors"
          )}
        >
          View on Mempool
          <ExternalLink className="w-4 h-4" />
        </a>

        {/* Reset */}
        <button
          onClick={resetFlow}
          className={cn(
            "flex items-center justify-center gap-2 p-3 rounded-[10px]",
            "bg-privacy/10 border border-privacy/20 text-privacy hover:bg-privacy/20 transition-colors"
          )}
        >
          <RefreshCw className="w-4 h-4" />
          New Stealth Send
        </button>
      </div>
    );
  }

  // Show form
  return (
    <div className="flex flex-col gap-4">
      {/* Your balance summary */}
      <div className="p-3 bg-btc/5 border border-btc/20 rounded-[10px]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-btc" />
            <span className="text-caption text-gray">Your Received zBTC</span>
          </div>
          {inboxLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-btc" />
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-body2 text-btc font-mono">
                {(Number(totalAmountSats) / 100_000_000).toFixed(8)} BTC
              </span>
              {depositCount > 0 && (
                <span className="text-caption text-gray">({depositCount})</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Recipient input - supports zkey or hex */}
      <div>
        <label className="text-body2 text-gray-light pl-2 mb-2 block">
          Recipient (.zkey or stealth address)
        </label>
        <div className="flex gap-2">
          <input
            value={recipientInput}
            onChange={(e) => {
              setRecipientInput(e.target.value);
              setResolvedMeta(null);
              setResolvedName(null);
              setError(null);
            }}
            placeholder="alice.zkey or 130 hex chars"
            className={cn(
              "flex-1 p-3 bg-muted border rounded-[10px]",
              "text-body2 font-mono text-foreground placeholder:text-gray",
              "outline-none transition-colors",
              error ? "border-red-500/50" : "border-gray/30 focus:border-privacy/50"
            )}
          />
          <button
            onClick={resolveRecipient}
            disabled={!recipientInput.trim() || resolving}
            className={cn(
              "px-4 py-2 rounded-[10px] text-body2 transition-colors",
              "bg-privacy hover:bg-privacy/80 text-background",
              "disabled:bg-gray/30 disabled:text-gray disabled:cursor-not-allowed"
            )}
          >
            {resolving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Resolve"}
          </button>
        </div>
        {resolvedMeta && (
          <p className="text-caption text-privacy mt-1 pl-2 flex items-center gap-1">
            <Check className="w-3 h-3" />
            {resolvedName ? (
              <>
                <Tag className="w-3 h-3" />
                {resolvedName}.zkey resolved
              </>
            ) : (
              "Valid stealth address"
            )}
          </p>
        )}
      </div>

      {/* Amount input */}
      <div>
        <div className="flex items-center justify-between pl-2 mb-2">
          <label className="text-body2 text-gray-light">Amount (BTC)</label>
        </div>
        <input
          type="number"
          value={amountBtc}
          onChange={(e) => setAmountBtc(e.target.value)}
          placeholder="0.001"
          step="0.00000001"
          min="0"
          className={cn(
            "w-full p-3 bg-muted border border-gray/30 rounded-[10px]",
            "text-body2 font-mono text-foreground placeholder:text-gray",
            "outline-none focus:border-btc/50 transition-colors"
          )}
        />
        {amountBtc && isValidAmount && (
          <p className="text-caption text-gray mt-1 pl-2">
            = {amountSats.toLocaleString()} satoshis
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-[10px] text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="text-caption">{error}</span>
        </div>
      )}

      {/* Create button */}
      <button
        onClick={handleCreateDeposit}
        disabled={loading || !resolvedMeta || !isValidAmount}
        className={cn(
          "flex items-center justify-center gap-2 p-3 rounded-[10px]",
          "bg-privacy hover:bg-privacy/80 text-background",
          "disabled:bg-gray/30 disabled:text-gray disabled:cursor-not-allowed",
          "transition-colors"
        )}
      >
        {loading ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            Creating...
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            Create Stealth Deposit
          </>
        )}
      </button>

      {/* Info */}
      <div className="p-3 bg-muted border border-gray/15 rounded-[10px]">
        <p className="text-caption text-gray">
          Stealth sends are private transfers where only the recipient can claim the funds.
          You&apos;ll get a BTC deposit address to send funds to.
        </p>
      </div>
    </div>
  );
}
