"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, CheckCircle2, Gift, ArrowRight, Bitcoin, Shield, Scissors, ExternalLink } from "lucide-react";
import { DEMO_NOTES, getClaimUrl } from "@/lib/test-data";

export default function DemoPage() {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyLink = async (index: number, link: string) => {
    await navigator.clipboard.writeText(link);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <main className="min-h-screen bg-[#0F0F12] p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">
            sbBTC Demo
          </h1>
          <p className="text-gray-400 text-lg">
            Pre-deposited claim links for demonstration
          </p>
        </div>

        {/* Flow Overview */}
        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 mb-8">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-400" />
            Demo Flow
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 bg-gray-800/50 rounded-xl">
              <div className="w-10 h-10 bg-orange-500/20 rounded-full flex items-center justify-center mx-auto mb-2">
                <Bitcoin className="w-5 h-5 text-orange-400" />
              </div>
              <p className="text-sm text-white font-medium">1. Deposit</p>
              <p className="text-xs text-gray-500">BTC → Taproot</p>
            </div>
            <div className="text-center p-4 bg-gray-800/50 rounded-xl">
              <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-2">
                <Gift className="w-5 h-5 text-purple-400" />
              </div>
              <p className="text-sm text-white font-medium">2. Claim</p>
              <p className="text-xs text-gray-500">ZK Proof → Mint</p>
            </div>
            <div className="text-center p-4 bg-gray-800/50 rounded-xl">
              <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-2">
                <Scissors className="w-5 h-5 text-blue-400" />
              </div>
              <p className="text-sm text-white font-medium">3. Split</p>
              <p className="text-xs text-gray-500">1 → 2 Links</p>
            </div>
          </div>
        </div>

        {/* Demo Notes */}
        <div className="space-y-4 mb-8">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Gift className="w-5 h-5 text-purple-400" />
            Pre-Deposited Claim Links
          </h2>
          <p className="text-gray-500 text-sm">
            Click a link to test the claim flow. These notes have simulated BTC deposits.
          </p>

          {DEMO_NOTES.map((note, index) => {
            const claimUrl = getClaimUrl(note, typeof window !== "undefined" ? window.location.origin : "");
            const isCopied = copiedIndex === index;

            return (
              <div
                key={index}
                className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 hover:border-purple-500/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-white font-medium">{note.description}</p>
                    <p className="text-green-400 font-mono text-lg">
                      {(note.amountSats / 100_000_000).toFixed(8)} BTC
                    </p>
                    <p className="text-purple-400 font-mono text-sm mt-1">
                      Secret: {note.seed}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyLink(index, note.seed)}
                      className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 flex items-center gap-1.5 transition-colors"
                    >
                      {isCopied ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          Copy Secret
                        </>
                      )}
                    </button>
                    <Link
                      href={`/claim?note=${encodeURIComponent(note.seed)}`}
                      className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm text-white flex items-center gap-1.5 transition-colors"
                    >
                      Claim
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
                <div className="text-xs text-gray-500 font-mono bg-gray-800/50 p-2 rounded">
                  Claim URL: {claimUrl}
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 gap-4">
          <Link
            href="/bridge"
            className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl hover:border-orange-500/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <Bitcoin className="w-6 h-6 text-orange-400" />
              <div>
                <p className="text-white font-medium group-hover:text-orange-400 transition-colors">
                  Bridge
                </p>
                <p className="text-xs text-gray-500">Deposit BTC</p>
              </div>
            </div>
          </Link>
          <a
            href="https://mempool.space/testnet"
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl hover:border-blue-500/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <ExternalLink className="w-6 h-6 text-blue-400" />
              <div>
                <p className="text-white font-medium group-hover:text-blue-400 transition-colors">
                  Mempool
                </p>
                <p className="text-xs text-gray-500">Bitcoin Testnet</p>
              </div>
            </div>
          </a>
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-gray-600 text-sm">
          <p>Demo Mode - Bitcoin Testnet + Solana Devnet</p>
        </div>
      </div>
    </main>
  );
}
