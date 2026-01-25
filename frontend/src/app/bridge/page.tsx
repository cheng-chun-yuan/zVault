"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  Gift,
  Wallet,
  Shield,
  Key,
  Copy,
  Check,
  Send,
  Tag,
  Loader2,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FeatureCard, type FeatureCardColor } from "@/components/ui";
import { BitcoinIcon } from "@/components/bitcoin-wallet-selector";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useZVaultKeys } from "@/hooks/use-zvault-keys";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useZkeyName } from "@/hooks/use-zkey-name";

interface FeatureConfig {
  icon: React.ReactNode;
  title: string;
  description: string;
  subtext: string;
  href: string;
  color: FeatureCardColor;
}

const features: FeatureConfig[] = [
  // Row 1 - Receive zBTC (Inbound)
  {
    icon: <ArrowDownToLine className="w-full h-full" />,
    title: "Deposit",
    description: "BTC → zBTC",
    subtext: "Bridge Bitcoin",
    href: "/bridge/deposit",
    color: "btc",
  },
  {
    icon: <Gift className="w-full h-full" />,
    title: "Claim",
    description: "Use claim link",
    subtext: "Redeem zBTC",
    href: "/claim",
    color: "sol",
  },
  {
    icon: <Inbox className="w-full h-full" />,
    title: "Inbox",
    description: "Received zBTC",
    subtext: "Stealth payments",
    href: "/bridge/received",
    color: "privacy",
  },
  // Row 2 - Spend zBTC (Outbound)
  {
    icon: <Send className="w-full h-full" />,
    title: "Pay",
    description: "Private payment",
    subtext: "Stealth or Link",
    href: "/bridge/stealth-send",
    color: "privacy",
  },
  {
    icon: <ArrowUpFromLine className="w-full h-full" />,
    title: "Withdraw",
    description: "zBTC → BTC",
    subtext: "Back to Bitcoin",
    href: "/bridge/withdraw",
    color: "btc",
  },
  {
    icon: <Wallet className="w-full h-full" />,
    title: "Notes",
    description: "View & Split",
    subtext: "Manage notes",
    href: "/bridge/activity",
    color: "gray",
  },
];

export default function BridgePage() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const {
    keys,
    stealthAddressEncoded,
    isLoading,
    error,
    deriveKeys
  } = useZVaultKeys();
  const { copied, copy } = useCopyToClipboard();
  const {
    registeredName,
    isRegistering,
    error: nameError,
    registerName,
    formatName,
    validateName,
  } = useZkeyName();

  // Name registration state
  const [showNameInput, setShowNameInput] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const nameValidationError = nameInput ? validateName(nameInput) : null;

  const handleRegisterName = async () => {
    if (!nameInput || nameValidationError) return;
    const success = await registerName(nameInput);
    if (success) {
      setShowNameInput(false);
      setNameInput("");
    }
  };

  const shortAddress = stealthAddressEncoded
    ? `${stealthAddressEncoded.slice(0, 16)}...${stealthAddressEncoded.slice(-16)}`
    : "";

  return (
    <main className="min-h-screen bg-background hacker-bg noise-overlay flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="w-full max-w-[680px] mb-6 flex items-center justify-between relative z-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-body2 text-gray hover:text-gray-light transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Home
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-btc/10 border border-btc/20">
            <BitcoinIcon className="w-3 h-3" />
            <span className="text-caption text-btc">BTC</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-privacy/10 border border-privacy/20">
            <Shield className="w-3 h-3 text-privacy" />
            <span className="text-caption text-privacy">ZK</span>
          </div>
        </div>
      </div>

      {/* Dashboard Container */}
      <div
        className={cn(
          "bg-card border border-solid border-gray/30 p-6",
          "w-[680px] max-w-[calc(100vw-32px)] rounded-[20px]",
          "glow-border cyber-corners relative z-10"
        )}
      >
        {/* Title Section */}
        <div className="text-center mb-6">
          <h1 className="text-heading5 text-foreground mb-2">
            zVault - Privacy BTC Bridge
          </h1>
          <p className="text-body2 text-gray">
            Bridge Bitcoin to Solana with zero-knowledge privacy
          </p>
        </div>

        {/* Stealth Address Section */}
        <div className="mb-6 p-4 bg-muted border border-privacy/20 rounded-[16px]">
          <div className="flex items-center gap-2 mb-3">
            <Key className="w-5 h-5 text-privacy" />
            <h2 className="text-body1 text-foreground">Your Stealth Address</h2>
          </div>

          {!wallet.connected ? (
            <div className="text-center py-4">
              <p className="text-body2 text-gray mb-3">
                Connect your wallet to generate a private stealth address
              </p>
              <button
                onClick={() => setVisible(true)}
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-2 rounded-[10px]",
                  "bg-privacy/20 hover:bg-privacy/30 border border-privacy/30",
                  "text-body2 text-privacy transition-colors"
                )}
              >
                <Wallet className="w-4 h-4" />
                Connect Wallet
              </button>
            </div>
          ) : !keys ? (
            <div className="text-center py-4">
              <p className="text-body2 text-gray mb-3">
                Sign a message to derive your private zVault keys
              </p>
              {error && (
                <p className="text-caption text-red-400 mb-3">{error}</p>
              )}
              <button
                onClick={deriveKeys}
                disabled={isLoading}
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-2 rounded-[10px]",
                  "bg-privacy hover:bg-privacy/80 disabled:bg-gray/30",
                  "text-body2 text-background disabled:text-gray transition-colors"
                )}
              >
                <Key className="w-4 h-4" />
                {isLoading ? "Signing..." : "Sign to Derive Keys"}
              </button>
            </div>
          ) : (
            <div>
              {/* Show registered name if available */}
              {registeredName && (
                <div className="flex items-center gap-2 p-3 bg-privacy/10 border border-privacy/30 rounded-[10px] mb-3">
                  <Tag className="w-4 h-4 text-privacy" />
                  <span className="text-body2-semibold text-privacy">
                    {formatName(registeredName)}
                  </span>
                  <button
                    onClick={() => copy(formatName(registeredName))}
                    className="ml-auto p-1.5 rounded-[6px] bg-privacy/10 hover:bg-privacy/20 transition-colors"
                    title="Copy .zkey name"
                  >
                    {copied ? (
                      <Check className="w-3 h-3 text-green-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-privacy" />
                    )}
                  </button>
                </div>
              )}

              {/* Stealth address */}
              <div className="flex items-center gap-2 p-3 bg-background/50 rounded-[10px] mb-2">
                <code className="flex-1 text-caption font-mono text-privacy truncate">
                  {shortAddress}
                </code>
                <button
                  onClick={() => copy(stealthAddressEncoded || "")}
                  className={cn(
                    "p-2 rounded-[6px] transition-colors",
                    "bg-privacy/10 hover:bg-privacy/20"
                  )}
                  title="Copy stealth address"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-privacy" />
                  )}
                </button>
              </div>

              {/* Name registration */}
              {!registeredName && !showNameInput && (
                <button
                  onClick={() => setShowNameInput(true)}
                  className="flex items-center gap-2 text-caption text-privacy hover:text-privacy/80 transition-colors mt-2"
                >
                  <Tag className="w-3 h-3" />
                  Register a .zkey name
                </button>
              )}

              {showNameInput && (
                <div className="mt-3 p-3 bg-background/50 rounded-[10px] border border-gray/20">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value.toLowerCase())}
                      placeholder="yourname"
                      className={cn(
                        "flex-1 px-3 py-2 bg-muted border rounded-[8px]",
                        "text-body2 text-foreground placeholder:text-gray",
                        "outline-none transition-colors",
                        nameValidationError
                          ? "border-red-500/50"
                          : "border-gray/30 focus:border-privacy/50"
                      )}
                    />
                    <span className="text-body2 text-gray">.zkey</span>
                  </div>
                  {nameValidationError && (
                    <p className="text-caption text-red-400 mb-2">{nameValidationError}</p>
                  )}
                  {nameError && (
                    <p className="text-caption text-red-400 mb-2">{nameError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={handleRegisterName}
                      disabled={isRegistering || !nameInput || !!nameValidationError}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-[8px]",
                        "bg-privacy hover:bg-privacy/80 text-background",
                        "disabled:bg-gray/30 disabled:text-gray disabled:cursor-not-allowed",
                        "transition-colors text-caption"
                      )}
                    >
                      {isRegistering ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Registering...
                        </>
                      ) : (
                        <>
                          <Tag className="w-3 h-3" />
                          Register
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setShowNameInput(false);
                        setNameInput("");
                      }}
                      className="px-3 py-2 rounded-[8px] bg-gray/20 hover:bg-gray/30 text-gray-light text-caption transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <p className="text-caption text-gray mt-2">
                Share this address to receive private payments. Only you can claim funds sent here.
              </p>
            </div>
          )}
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {features.map((feature) => (
            <FeatureCard
              key={feature.title}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
              subtext={feature.subtext}
              href={feature.href}
              color={feature.color}
            />
          ))}
        </div>

        {/* Info Section */}
        <div className="p-4 bg-muted border border-gray/15 rounded-[12px] mb-4">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-privacy shrink-0 mt-0.5" />
            <div>
              <p className="text-body2-semibold text-privacy mb-1">
                Privacy Preserving Bridge
              </p>
              <p className="text-caption text-gray">
                Your deposits and withdrawals are protected by zero-knowledge proofs.
                No one can link your Bitcoin deposits to zBTC claims.
              </p>
            </div>
          </div>
        </div>

        {/* Network Status */}
        <div className="flex items-center justify-center gap-2 py-2 px-3 bg-warning/10 border border-warning/20 rounded-[8px]">
          <div className="w-2 h-2 rounded-full bg-warning animate-pulse" />
          <span className="text-caption text-warning">
            Bitcoin Testnet3 + Solana Devnet
          </span>
        </div>

        {/* Footer */}
        <div className="flex flex-row justify-between items-center gap-2 mt-4 text-gray pt-4 border-t border-gray/15">
          <div className="flex flex-row items-center gap-4">
            <a
              href="https://zVault.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-light transition-colors text-caption"
            >
              zVault
            </a>
            <a
              href="https://github.com/zVault"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-light transition-colors text-caption"
            >
              GitHub
            </a>
            <a
              href="https://docs.zVault.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-light transition-colors text-caption"
            >
              Docs
            </a>
          </div>
          <p className="text-caption">Powered by Privacy Cash</p>
        </div>
      </div>
    </main>
  );
}
