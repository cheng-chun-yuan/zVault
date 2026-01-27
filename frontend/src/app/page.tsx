"use client";

import React, { memo } from "react";
import Link from "next/link";
import { Bitcoin, Shield, Zap, Lock, ExternalLink, ArrowRight, EyeOff, Fingerprint, ShieldCheck, Loader2 } from "lucide-react";
import { BitcoinIcon } from "@/components/bitcoin-wallet-selector";
import { usePoolStats, PoolStats } from "@/hooks/use-pool-stats";

const FeatureCard = memo(function FeatureCard({
  icon: Icon,
  title,
  description,
  variant = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  variant?: "default" | "bitcoin" | "privacy" | "cyber";
}) {
  const variantStyles = {
    default: {
      iconBg: "bg-[#FFABFE1A]",
      iconColor: "text-[#FFABFE]",
      cardClass: "gradient-bg-card",
    },
    bitcoin: {
      iconBg: "bg-[#F7931A1A]",
      iconColor: "text-[#F7931A] btc-glow",
      cardClass: "gradient-bg-bitcoin",
    },
    privacy: {
      iconBg: "bg-[#14F1951A]",
      iconColor: "text-[#14F195] privacy-glow",
      cardClass: "gradient-bg-card privacy-lines",
    },
    cyber: {
      iconBg: "bg-[#00FFFF1A]",
      iconColor: "text-[#00FFFF]",
      cardClass: "gradient-bg-cyber",
    },
  };

  const style = variantStyles[variant];

  return (
    <div className={`p-6 rounded-[16px] ${style.cardClass} space-y-3 text-left`}>
      <div className="flex justify-start">
        <div className={`p-3 rounded-[12px] ${style.iconBg}`}>
          <Icon className={`h-6 w-6 ${style.iconColor}`} />
        </div>
      </div>
      <h3 className="text-heading6 text-foreground">{title}</h3>
      <p className="text-body2 text-[#8B8A9E]">{description}</p>
    </div>
  );
});

FeatureCard.displayName = "FeatureCard";

const StatsDisplay = memo(function StatsDisplay({
  stats,
  isLoading,
}: {
  stats: PoolStats | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-6 h-6 animate-spin text-[#8B8A9E]" />
      </div>
    );
  }

  // Total Bridged = total minted on Solana (in BTC)
  const totalBridgedBtc = (Number(stats?.totalMinted ?? 0n) / 100000000).toFixed(4);
  // Vault Held = total minted - total burned (current circulating supply)
  const vaultHeld = Number((stats?.totalMinted ?? 0n) - (stats?.totalBurned ?? 0n));
  const vaultHeldBtc = (vaultHeld / 100000000).toFixed(4);
  const totalDeposits = (stats?.depositCount ?? 0).toLocaleString();
  const pendingCount = (stats?.pendingRedemptions ?? 0).toLocaleString();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
      <div className="space-y-2 text-center">
        <div className="flex items-center justify-center gap-2">
          <BitcoinIcon className="w-5 h-5 btc-glow" />
          <span className="text-heading5 text-[#F7931A]">{totalBridgedBtc}</span>
        </div>
        <div className="text-caption text-[#8B8A9E]">Total Bridged (BTC)</div>
      </div>
      <div className="space-y-2 text-center">
        <div className="flex items-center justify-center gap-2">
          <Shield className="w-5 h-5 text-[#14F195] privacy-glow" />
          <span className="text-heading5 text-[#14F195]">{vaultHeldBtc}</span>
        </div>
        <div className="text-caption text-[#8B8A9E]">Vault Held (BTC)</div>
      </div>
      <div className="space-y-2 text-center">
        <div className="text-heading5 text-foreground">
          {totalDeposits}
        </div>
        <div className="text-caption text-[#8B8A9E]">Total Deposits</div>
      </div>
      <div className="space-y-2 text-center">
        <div className="text-heading5 text-foreground">
          {pendingCount}
        </div>
        <div className="text-caption text-[#8B8A9E]">Pending</div>
      </div>
    </div>
  );
});

StatsDisplay.displayName = "StatsDisplay";

export default function Home() {
  // Fetch real stats from on-chain pool state
  const { stats, isLoading } = usePoolStats();

  return (
    <main className="min-h-screen bg-[#0F0F12] hacker-bg noise-overlay">
      <div className="container mx-auto px-4 py-8 relative z-10">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-[12px] bg-gradient-to-br from-[#F7931A33] to-[#14F19533] border border-[#F7931A33]">
              <div className="relative">
                <BitcoinIcon className="h-6 w-6 btc-glow" />
                <Shield className="h-3 w-3 text-[#14F195] absolute -bottom-1 -right-1" />
              </div>
            </div>
            <span className="text-heading6 text-foreground">zVault</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://docs.zVault.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="text-body2 text-[#8B8A9E] hover:text-[#C7C5D1] transition-colors flex items-center gap-1"
            >
              Docs
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://github.com/zVault"
              target="_blank"
              rel="noopener noreferrer"
              className="text-body2 text-[#8B8A9E] hover:text-[#C7C5D1] transition-colors flex items-center gap-1"
            >
              GitHub
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </header>

        {/* Main content */}
        <div className="flex flex-col gap-8 items-center max-w-4xl mx-auto">
          {/* Hero section */}
          <div className="text-center space-y-8 w-full">
            {/* Hero */}
            <div className="space-y-6">
              {/* Bitcoin + Privacy badge */}
              <div className="flex items-center justify-center gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F7931A1A] border border-[#F7931A33]">
                  <BitcoinIcon className="w-4 h-4" />
                  <span className="text-caption text-[#F7931A]">Bitcoin Native</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#14F1951A] border border-[#14F19533]">
                  <Shield className="w-4 h-4 text-[#14F195]" />
                  <span className="text-caption text-[#14F195]">ZK Privacy</span>
                </div>
              </div>

              {/* Main headline */}
              <h1 className="text-4xl lg:text-6xl font-bold text-foreground leading-tight">
                <span className="bg-gradient-to-r from-[#F7931A] to-[#FFA940] bg-clip-text text-transparent">
                  Bitcoin
                </span>{" "}
                Meets<br />
                <span className="bg-gradient-to-r from-[#14F195] to-[#9945FF] bg-clip-text text-transparent">
                  Zero-Knowledge Privacy
                </span>
              </h1>

              <p className="text-body1 text-[#C7C5D1] max-w-xl mx-auto">
                Bridge your BTC to Solana with complete privacy. Zero-knowledge proofs ensure
                your transactions remain confidential while maintaining full Bitcoin backing.
              </p>

              {/* Privacy features inline */}
              <div className="flex flex-wrap items-center justify-center gap-4 text-caption text-[#8B8A9E]">
                <div className="flex items-center gap-1.5">
                  <EyeOff className="w-4 h-4 text-[#14F195]" />
                  <span>Hidden Amounts</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Fingerprint className="w-4 h-4 text-[#9945FF]" />
                  <span>Anonymous Transfers</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#F7931A]" />
                  <span>1:1 BTC Backed</span>
                </div>
              </div>

              {/* CTA Button */}
              <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  href="/bridge"
                  className="btn-bitcoin inline-flex items-center gap-2 px-8 py-4 text-lg"
                >
                  <BitcoinIcon className="w-5 h-5" />
                  Launch Bridge
                  <ArrowRight className="w-5 h-5" />
                </Link>
                <a
                  href="https://docs.zVault.xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-tertiary inline-flex items-center gap-2 px-6 py-4"
                >
                  <Shield className="w-5 h-5" />
                  Learn About Privacy
                </a>
              </div>
            </div>

            {/* Features */}
            <div className="grid md:grid-cols-2 gap-4">
              <FeatureCard
                icon={EyeOff}
                title="Privacy Protected"
                description="Zero-knowledge proofs ensure your transaction amounts and history remain confidential"
                variant="cyber"
              />
              <FeatureCard
                icon={Bitcoin}
                title="1:1 BTC Backed"
                description="Each zkBTC token is fully backed by real Bitcoin locked in escrow"
                variant="bitcoin"
              />
              <FeatureCard
                icon={Zap}
                title="Fast & Efficient"
                description="Quick bridging with automatic confirmation tracking and instant minting"
              />
              <FeatureCard
                icon={ShieldCheck}
                title="OFAC Compliant"
                description="Built-in compliance screening ensures regulatory compliance while preserving privacy"
                variant="cyber"
              />
            </div>

            {/* Stats */}
            <div className="gradient-bg-card p-6 rounded-[16px] w-full">
              <h3 className="text-caption text-[#8B8A9E] uppercase tracking-wide mb-4 text-center">
                Bridge Statistics
              </h3>
              <StatsDisplay stats={stats} isLoading={isLoading} />
            </div>

            {/* How it works */}
            <div className="space-y-6">
              <h2 className="text-heading5 text-foreground">How It Works</h2>
              <div className="grid md:grid-cols-3 gap-6">
                {/* Step 1 - Bitcoin */}
                <div className="flex flex-col items-center text-center gap-3 p-5 gradient-bg-bitcoin rounded-[12px]">
                  <div className="w-12 h-12 rounded-full bg-[#F7931A1A] border border-[#F7931A33] flex items-center justify-center">
                    <Bitcoin className="w-6 h-6 text-[#F7931A] btc-glow" />
                  </div>
                  <div>
                    <h3 className="text-body2-semibold text-foreground mb-1">Deposit BTC</h3>
                    <p className="text-caption text-[#8B8A9E]">Connect your wallet and send Bitcoin to your unique deposit address</p>
                  </div>
                </div>

                {/* Step 2 - Privacy */}
                <div className="flex flex-col items-center text-center gap-3 p-5 gradient-bg-card privacy-lines rounded-[12px]">
                  <div className="w-12 h-12 rounded-full bg-[#14F1951A] border border-[#14F19533] flex items-center justify-center">
                    <Shield className="w-6 h-6 text-[#14F195] privacy-glow" />
                  </div>
                  <div>
                    <h3 className="text-body2-semibold text-foreground mb-1">Shield with ZK</h3>
                    <p className="text-caption text-[#8B8A9E]">Your deposit is shielded using zero-knowledge proofs for privacy</p>
                  </div>
                </div>

                {/* Step 3 - Mint */}
                <div className="flex flex-col items-center text-center gap-3 p-5 gradient-bg-card rounded-[12px]">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#F7931A33] to-[#14F19533] border border-[#9945FF33] flex items-center justify-center">
                    <Lock className="w-6 h-6 text-[#9945FF]" />
                  </div>
                  <div>
                    <h3 className="text-body2-semibold text-foreground mb-1">Mint zkBTC</h3>
                    <p className="text-caption text-[#8B8A9E]">Receive privacy-protected zkBTC tokens on Solana</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-[#8B8A9E26]">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <BitcoinIcon className="w-4 h-4" />
              <span className="text-caption text-[#F7931A]">Bitcoin</span>
              <span className="text-caption text-[#8B8A9E]">+</span>
              <Shield className="w-4 h-4 text-[#14F195]" />
              <span className="text-caption text-[#14F195]">Privacy</span>
              <span className="text-caption text-[#8B8A9E]">=</span>
              <span className="text-caption text-foreground">zVault</span>
            </div>
            <p className="text-caption text-[#8B8A9E]">
              Demo Version - Testnet Only
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}
