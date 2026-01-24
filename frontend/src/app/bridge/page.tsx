"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  Gift,
  Scissors,
  Wallet,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FeatureCard, type FeatureCardColor } from "@/components/ui";
import { BitcoinIcon } from "@/components/bitcoin-wallet-selector";

interface FeatureConfig {
  icon: React.ReactNode;
  title: string;
  description: string;
  subtext: string;
  href: string;
  color: FeatureCardColor;
}

const features: FeatureConfig[] = [
  {
    icon: <ArrowDownToLine className="w-full h-full" />,
    title: "Deposit",
    description: "BTC → sbBTC",
    subtext: "Get claim link",
    href: "/bridge/deposit",
    color: "btc",
  },
  {
    icon: <ArrowUpFromLine className="w-full h-full" />,
    title: "Withdraw",
    description: "sbBTC → zBTC",
    subtext: "Public SPL token",
    href: "/bridge/withdraw",
    color: "purple",
  },
  {
    icon: <Gift className="w-full h-full" />,
    title: "Claim",
    description: "Use claim link",
    subtext: "Redeem sbBTC",
    href: "/claim",
    color: "privacy",
  },
  {
    icon: <Scissors className="w-full h-full" />,
    title: "Split",
    description: "Divide note",
    subtext: "Send to friend",
    href: "/claim?action=split",
    color: "sol",
  },
  {
    icon: <Wallet className="w-full h-full" />,
    title: "Balance",
    description: "View notes",
    subtext: "Activity history",
    href: "/bridge/activity",
    color: "gray",
  },
  {
    icon: <Shield className="w-full h-full" />,
    title: "Prove",
    description: "Test ZK proofs",
    subtext: "Developer tool",
    href: "/prove",
    color: "privacy",
  },
];

export default function BridgePage() {
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
                No one can link your Bitcoin deposits to sbBTC claims.
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
