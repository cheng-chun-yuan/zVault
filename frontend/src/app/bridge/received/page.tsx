"use client";

import { Inbox, Shield } from "lucide-react";
import { FlowPageLayout } from "@/components/ui";
import { useZVaultKeys } from "@/hooks/use-zvault-keys";
import { useStealthInbox } from "@/hooks/use-stealth-inbox";
import { EmptyInbox, InboxList } from "@/components/stealth-inbox";

export default function ReceivedPage() {
  const { hasKeys, deriveKeys, isLoading: keysLoading } = useZVaultKeys();
  const { notes, isLoading, error, refresh } = useStealthInbox();

  return (
    <FlowPageLayout
      backHref="/bridge"
      backLabel="Back"
      badges={[
        {
          icon: <Inbox className="w-full h-full" />,
          label: "Inbox",
          color: "privacy",
        },
      ]}
      titleIcon={<Inbox className="w-full h-full" />}
      title="Stealth Inbox"
      description="Incoming private deposits sent to your stealth address"
    >
      {/* Error state */}
      {error && (
        <div className="warning-box mb-4">
          <span>{error}</span>
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
        <EmptyInbox
          hasKeys={hasKeys}
          onDeriveKeys={deriveKeys}
          isLoading={keysLoading}
        />
      )}

      {/* Inbox list */}
      {!isLoading && hasKeys && notes.length > 0 && (
        <InboxList
          notes={notes}
          isLoading={isLoading}
          onRefresh={refresh}
        />
      )}

      {/* Privacy info */}
      <div className="mt-4 p-3 bg-[#14F1950D] border border-[#14F19526] rounded-[12px]">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4 text-[#14F195]" />
          <span className="text-caption text-[#14F195]">Privacy Protected</span>
        </div>
        <p className="text-caption text-[#8B8A9E]">
          Only you can see deposits addressed to your stealth address. Scanning
          happens locally using your viewing key.
        </p>
      </div>
    </FlowPageLayout>
  );
}
