"use client";

import { useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Wallet,
  ArrowDownToLine,
  Shield,
  Inbox,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/error-boundary";
import { BalanceView } from "@/components/btc-widget/balance-view";
import { useZVaultKeys, useStealthInbox } from "@/hooks/use-zvault";
import { InboxList, EmptyInbox } from "@/components/stealth-inbox";

type TabType = "deposits" | "claimable" | "claimed";

const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: "deposits", label: "Deposits", icon: <ArrowDownToLine className="w-4 h-4" /> },
  { id: "claimable", label: "Claimable", icon: <Inbox className="w-4 h-4" /> },
  { id: "claimed", label: "Claimed", icon: <CheckCircle2 className="w-4 h-4" /> },
];

function TabBar({
  activeTab,
  onTabChange,
  claimableCount,
}: {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  claimableCount: number;
}) {
  return (
    <div className="flex gap-1 p-1 bg-muted border border-gray/15 rounded-[12px] cyber-corners">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-[10px] text-sm transition-colors",
            activeTab === tab.id
              ? "bg-privacy/10 text-privacy border border-privacy/20 neon-border-pulse"
              : "text-gray hover:text-gray-light hover:bg-gray/10"
          )}
        >
          {tab.icon}
          <span className={activeTab === tab.id ? "neon-privacy" : ""}>{tab.label}</span>
          {tab.id === "claimable" && claimableCount > 0 && (
            <span className="min-w-[22px] h-[22px] px-2 flex items-center justify-center text-sm rounded-full bg-privacy text-background font-bold shadow-[0_0_12px_rgba(20,241,149,0.7),0_0_24px_rgba(20,241,149,0.4)] neon-privacy animate-pulse">
              {claimableCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function ClaimedTab() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="rounded-full bg-[#8B8A9E1A] p-4 mb-4">
        <CheckCircle2 className="h-10 w-10 text-[#8B8A9E]" />
      </div>
      <p className="text-heading6 text-foreground mb-2">No Claimed Notes Yet</p>
      <p className="text-body2 text-[#8B8A9E] mb-4">
        When you claim notes from deposits or stealth transfers, they will appear here
      </p>
      <p className="text-caption text-[#8B8A9E66]">
        Claimed notes can be used for payments or withdrawals
      </p>
    </div>
  );
}

function ClaimableTab() {
  const { hasKeys, deriveKeys, isLoading: keysLoading } = useZVaultKeys();
  const { notes, isLoading, error, refresh } = useStealthInbox();

  return (
    <div className="space-y-4">
      {/* Error state */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading state */}
      {isLoading && hasKeys && (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-[#8B8A9E]">
            <div className="w-5 h-5 border-2 border-[#14F195] border-t-transparent rounded-full animate-spin" />
            <span className="text-body2">Scanning announcements...</span>
          </div>
        </div>
      )}

      {/* Empty or no keys */}
      {!isLoading && (notes.length === 0 || !hasKeys) && (
        <EmptyInbox hasKeys={hasKeys} onDeriveKeys={deriveKeys} isLoading={keysLoading} />
      )}

      {/* Inbox list */}
      {!isLoading && hasKeys && notes.length > 0 && (
        <InboxList notes={notes} isLoading={isLoading} onRefresh={refresh} />
      )}

      {/* Privacy info */}
      <div className="p-3 bg-[#14F1950D] border border-[#14F19526] rounded-[12px]">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4 text-[#14F195]" />
          <span className="text-caption text-[#14F195]">Privacy Protected</span>
        </div>
        <p className="text-caption text-[#8B8A9E]">
          Only you can see deposits addressed to your stealth address. Scanning happens
          locally using your viewing key.
        </p>
      </div>
    </div>
  );
}

function ActivityContent() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as TabType | null;
  const [activeTab, setActiveTab] = useState<TabType>(tabParam || "claimable");
  const { notes } = useStealthInbox();

  // Update URL when tab changes
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
  };

  // Sync with URL on mount
  useEffect(() => {
    if (tabParam && tabs.some((t) => t.id === tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  return (
    <>
      {/* Tab Bar */}
      <div className="mb-4">
        <TabBar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          claimableCount={notes.length}
        />
      </div>

      {/* Tab Content */}
      <ErrorBoundary>
        {activeTab === "deposits" && <BalanceView />}
        {activeTab === "claimable" && <ClaimableTab />}
        {activeTab === "claimed" && <ClaimedTab />}
      </ErrorBoundary>
    </>
  );
}

export default function ActivityPage() {
  return (
    <main className="min-h-screen bg-background hacker-bg noise-overlay flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="w-full max-w-[480px] mb-4 flex items-center justify-between relative z-10">
        <Link
          href="/bridge"
          className="inline-flex items-center gap-2 text-body2 text-gray hover:text-gray-light transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-privacy/10 border border-privacy/20">
            <Wallet className="w-3 h-3 text-privacy" />
            <span className="text-caption text-privacy">Notes</span>
          </div>
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
        {/* Title */}
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray/15">
          <div className="p-2 rounded-[10px] bg-privacy/10 border border-privacy/20">
            <Wallet className="w-5 h-5 text-privacy" />
          </div>
          <div>
            <h1 className="text-heading6 text-foreground">Your Notes</h1>
            <p className="text-caption text-gray">
              Manage deposits, claim incoming zBTC, and view owned notes
            </p>
          </div>
        </div>

        {/* Content with Suspense for searchParams */}
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-2 border-[#14F195] border-t-transparent rounded-full animate-spin" />
            </div>
          }
        >
          <ActivityContent />
        </Suspense>

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
          <p className="text-caption">Powered by zVault</p>
        </div>
      </div>
    </main>
  );
}
