"use client";

import Link from "next/link";
import { ArrowLeft, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/error-boundary";
import { BalanceView } from "@/components/btc-widget/balance-view";

export default function ActivityPage() {
  return (
    <main className="min-h-screen bg-background hacker-bg noise-overlay flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="w-full max-w-[420px] mb-4 flex items-center justify-between relative z-10">
        <Link
          href="/bridge"
          className="inline-flex items-center gap-2 text-body2 text-gray hover:text-gray-light transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray/10 border border-gray/20">
            <Wallet className="w-3 h-3 text-gray-light" />
            <span className="text-caption text-gray-light">Balance</span>
          </div>
        </div>
      </div>

      {/* Widget */}
      <div
        className={cn(
          "bg-card border border-solid border-gray/30 p-4",
          "w-[420px] max-w-[calc(100vw-32px)] rounded-[16px]",
          "glow-border cyber-corners relative z-10"
        )}
      >
        {/* Title */}
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray/15">
          <div className="p-2 rounded-[10px] bg-gray/10 border border-gray/20">
            <Wallet className="w-5 h-5 text-gray-light" />
          </div>
          <div>
            <h1 className="text-heading6 text-foreground">Balance & Activity</h1>
            <p className="text-caption text-gray">View your notes and transaction history</p>
          </div>
        </div>

        {/* Content */}
        <ErrorBoundary>
          <BalanceView />
        </ErrorBoundary>

        {/* Footer */}
        <div className="flex flex-row justify-between items-center gap-2 mt-4 text-gray px-2 pt-4 border-t border-gray/15">
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
          </div>
          <p className="text-caption">Powered by Privacy Cash</p>
        </div>
      </div>
    </main>
  );
}
