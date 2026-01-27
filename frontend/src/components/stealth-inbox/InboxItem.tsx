"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Clock, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBtc } from "@/lib/utils/formatting";
import type { InboxNote } from "@/hooks/use-zvault";

interface InboxItemProps {
  note: InboxNote;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

export function InboxItem({ note }: InboxItemProps) {
  const router = useRouter();

  const handleClaim = () => {
    // Navigate to claim page with the note data
    // The claim page will need to handle stealth notes
    const params = new URLSearchParams({
      stealth: "true",
      commitment: note.commitmentHex,
      leafIndex: note.leafIndex.toString(),
      amount: note.amount.toString(),
    });
    router.push(`/claim?${params.toString()}`);
  };

  return (
    <div
      className={cn(
        "p-4 rounded-[12px] border border-gray/15 bg-muted",
        "hover:border-privacy/40 transition-all duration-300 cyber-corners hover-glow"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-[6px] bg-privacy/10 pulse-glow">
            <Shield className="w-4 h-4 text-privacy privacy-glow" />
          </div>
          <span className="text-body2-semibold text-foreground">
            Stealth Deposit
          </span>
        </div>
        <div className="flex items-center gap-1 text-caption text-gray">
          <Clock className="w-3 h-3" />
          <span className="terminal-text">{formatRelativeTime(note.createdAt)}</span>
        </div>
      </div>

      {/* Amount */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-heading5 text-privacy neon-privacy">
            {formatBtc(Number(note.amount))} zBTC
          </p>
          <p className="text-caption text-gray terminal-text">
            {Number(note.amount).toLocaleString()} sats
          </p>
        </div>
        <div className="px-2 py-1 rounded-full bg-privacy/10 border border-privacy/20 neon-border-pulse">
          <span className="text-caption text-privacy neon-privacy">Ready to Claim</span>
        </div>
      </div>

      {/* Commitment (truncated) */}
      <div className="p-2 bg-background rounded-[8px] mb-4">
        <p className="text-caption text-gray mb-1 terminal-text">Commitment</p>
        <code className="text-caption font-mono text-gray-light truncate block terminal-text">
          {note.commitmentHex.slice(0, 16)}...{note.commitmentHex.slice(-16)}
        </code>
      </div>

      {/* Claim button */}
      <button
        onClick={handleClaim}
        className="btn-primary w-full justify-center hover-glow"
      >
        Claim zBTC
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
