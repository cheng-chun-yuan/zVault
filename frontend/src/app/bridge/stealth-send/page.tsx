"use client";

import { Send, Shield } from "lucide-react";
import { FlowPageLayout } from "@/components/ui";
import { StealthSendFlow } from "@/components/stealth-send-flow";

export default function StealthSendPage() {
  return (
    <FlowPageLayout
      backHref="/bridge"
      backLabel="Back"
      badges={[
        {
          icon: <Shield className="w-full h-full" />,
          label: "Private",
          color: "privacy",
        },
      ]}
      titleIcon={<Send className="w-full h-full" />}
      title="Stealth Send"
      description="Send BTC privately to a stealth address"
      width={480}
    >
      <StealthSendFlow />
    </FlowPageLayout>
  );
}
