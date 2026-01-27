"use client";

import { ArrowUpFromLine } from "lucide-react";
import { FlowPageLayout } from "@/components/ui";
import { WithdrawFlow } from "@/components/btc-widget/withdraw-flow";

export default function WithdrawPage() {
  return (
    <FlowPageLayout
      backHref="/bridge"
      backLabel="Back"
      badges={[
        {
          icon: <ArrowUpFromLine className="w-full h-full" />,
          label: "Withdraw",
          color: "purple",
        },
      ]}
      titleIcon={<ArrowUpFromLine className="w-full h-full" />}
      title="Withdraw zkBTC"
      description="Convert private zkBTC to public zBTC"
    >
      <WithdrawFlow />
    </FlowPageLayout>
  );
}
