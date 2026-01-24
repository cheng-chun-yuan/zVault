"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { ManualVerify } from "@/components/btc-widget/manual-verify";

export default function ProvePage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <main className="min-h-screen bg-[#0F0F12] hacker-bg noise-overlay flex flex-col items-center justify-center p-4">
        <div className="w-16 h-16 rounded-full border-4 border-[#8B8A9E26] border-t-[#14F195] animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0F0F12] hacker-bg noise-overlay flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="w-full max-w-[480px] mb-4 flex items-center justify-between relative z-10">
        <Link
          href="/bridge"
          className="inline-flex items-center gap-2 text-body2 text-[#8B8A9E] hover:text-[#C7C5D1] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Bridge
        </Link>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#14F1951A] border border-[#14F19533]">
          <Shield className="w-3 h-3 text-[#14F195]" />
          <span className="text-caption text-[#14F195]">SPV Verify</span>
        </div>
      </div>

      {/* Widget */}
      <div
        className={cn(
          "bg-[#202027] border border-solid border-[#8B8A9E4D] p-4",
          "w-[480px] max-w-[calc(100vw-32px)] rounded-[16px]",
          "glow-border cyber-corners relative z-10"
        )}
      >
        <ManualVerify />
      </div>
    </main>
  );
}
