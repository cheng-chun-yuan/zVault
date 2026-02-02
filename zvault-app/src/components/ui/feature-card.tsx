"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export type FeatureCardColor = "btc" | "privacy" | "sol" | "purple" | "gray";

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  subtext: string;
  href: string;
  color: FeatureCardColor;
}

const colorConfig: Record<FeatureCardColor, {
  iconBg: string;
  iconBorder: string;
  iconText: string;
  hoverBorder: string;
  hoverBg: string;
}> = {
  btc: {
    iconBg: "bg-btc/10",
    iconBorder: "border-btc/20",
    iconText: "text-btc",
    hoverBorder: "hover:border-btc/40",
    hoverBg: "hover:bg-btc/5",
  },
  privacy: {
    iconBg: "bg-privacy/10",
    iconBorder: "border-privacy/20",
    iconText: "text-privacy",
    hoverBorder: "hover:border-privacy/40",
    hoverBg: "hover:bg-privacy/5",
  },
  sol: {
    iconBg: "bg-sol/10",
    iconBorder: "border-sol/20",
    iconText: "text-sol",
    hoverBorder: "hover:border-sol/40",
    hoverBg: "hover:bg-sol/5",
  },
  purple: {
    iconBg: "bg-purple/10",
    iconBorder: "border-purple/20",
    iconText: "text-purple",
    hoverBorder: "hover:border-purple/40",
    hoverBg: "hover:bg-purple/5",
  },
  gray: {
    iconBg: "bg-gray/10",
    iconBorder: "border-gray/20",
    iconText: "text-gray-light",
    hoverBorder: "hover:border-gray/40",
    hoverBg: "hover:bg-gray/5",
  },
};

export function FeatureCard({ icon, title, description, subtext, href, color }: FeatureCardProps) {
  const config = colorConfig[color];

  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col items-center p-6 rounded-[16px]",
        "bg-card border border-gray/30",
        "transition-all duration-300 cursor-pointer",
        config.hoverBorder,
        config.hoverBg,
        "group"
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "w-14 h-14 rounded-[12px] flex items-center justify-center mb-4",
          config.iconBg,
          "border",
          config.iconBorder,
          "transition-transform duration-300 group-hover:scale-110"
        )}
      >
        <div className={cn("w-7 h-7", config.iconText)}>
          {icon}
        </div>
      </div>

      {/* Title */}
      <h3 className="text-body1 text-foreground mb-1">{title}</h3>

      {/* Description */}
      <p className="text-body2 text-gray-light mb-1">{description}</p>

      {/* Subtext */}
      <span className="text-caption text-gray">{subtext}</span>
    </Link>
  );
}
