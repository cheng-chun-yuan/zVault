"use client";

import { Send } from "lucide-react";
import { FlowPageLayout } from "@/components/ui";
import { PayFlow } from "@/components/btc-widget/pay-flow";

export default function PayPage() {
  return (
    <FlowPageLayout
      backHref="/bridge"
      backLabel="Back"
      badges={[
        {
          icon: <Send className="w-full h-full" />,
          label: "Pay",
          color: "purple",
        },
      ]}
      titleIcon={<Send className="w-full h-full" />}
      title="Pay with zkBTC"
      description="Send zkBTC publicly or privately"
    >
      <PayFlow />
    </FlowPageLayout>
  );
}
