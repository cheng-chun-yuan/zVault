"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  Circle,
  Loader2,
  XCircle,
  Shield,
  X,
} from "lucide-react";

/**
 * Steps in a pool operation
 */
export type PoolOperationStep =
  | "preparing"
  | "generating_proof"
  | "building_tx"
  | "sending_tx"
  | "confirming"
  | "complete"
  | "error";

/**
 * Status update for pool operations
 */
export interface PoolOperationStatus {
  step: PoolOperationStep;
  message: string;
  progress?: number; // 0-100
  error?: string;
}

interface OperationStatusProps {
  status: PoolOperationStatus | null;
  isOpen: boolean;
  onClose?: () => void;
  title?: string;
}

type StepStatus = "pending" | "active" | "complete" | "error";

interface StepConfig {
  key: PoolOperationStep;
  label: string;
  icon?: ReactNode;
}

const STEPS: StepConfig[] = [
  { key: "preparing", label: "Preparing" },
  { key: "generating_proof", label: "Generating ZK Proof" },
  { key: "building_tx", label: "Building Transaction" },
  { key: "sending_tx", label: "Sending" },
  { key: "confirming", label: "Confirming" },
  { key: "complete", label: "Complete" },
];

function getStepIndex(step: PoolOperationStep): number {
  const index = STEPS.findIndex((s) => s.key === step);
  return index === -1 ? 0 : index;
}

function getStepStatus(
  stepKey: PoolOperationStep,
  currentStep: PoolOperationStep
): StepStatus {
  if (currentStep === "error") {
    return "error";
  }

  const currentIndex = getStepIndex(currentStep);
  const stepIndex = getStepIndex(stepKey);

  if (stepIndex < currentIndex) {
    return "complete";
  } else if (stepIndex === currentIndex) {
    return currentStep === "complete" ? "complete" : "active";
  }
  return "pending";
}

function StepIndicator({
  label,
  status,
  isActive,
}: {
  label: string;
  status: StepStatus;
  isActive: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      {status === "complete" && (
        <CheckCircle className="w-5 h-5 text-green-400" />
      )}
      {status === "active" && (
        <Loader2 className="w-5 h-5 text-privacy animate-spin" />
      )}
      {status === "pending" && <Circle className="w-5 h-5 text-gray/40" />}
      {status === "error" && <XCircle className="w-5 h-5 text-red-400" />}
      <span
        className={cn(
          "text-body2",
          isActive ? "text-foreground" : "text-gray",
          status === "complete" && "text-green-400",
          status === "error" && "text-red-400"
        )}
      >
        {label}
      </span>
    </div>
  );
}

export function OperationStatus({
  status,
  isOpen,
  onClose,
  title = "Processing",
}: OperationStatusProps) {
  if (!isOpen || !status) return null;

  const isComplete = status.step === "complete";
  const isError = status.step === "error";
  const canClose = isComplete || isError;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-gray/30 rounded-[20px] p-6 w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-privacy" />
            <h3 className="text-heading6 text-foreground">{title}</h3>
          </div>
          {canClose && onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-gray/20 transition-colors"
            >
              <X className="w-4 h-4 text-gray" />
            </button>
          )}
        </div>

        {/* Step indicators */}
        <div className="space-y-3 mb-4">
          {STEPS.filter((s) => s.key !== "error").map((step) => (
            <StepIndicator
              key={step.key}
              label={step.label}
              status={getStepStatus(step.key, status.step)}
              isActive={step.key === status.step}
            />
          ))}
        </div>

        {/* Progress bar for proof generation */}
        {status.step === "generating_proof" && status.progress !== undefined && (
          <div className="mb-4">
            <div className="h-2 bg-gray/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-privacy transition-all duration-300 ease-out"
                style={{ width: `${status.progress}%` }}
              />
            </div>
            <p className="text-caption text-gray mt-1 text-right">
              {status.progress}%
            </p>
          </div>
        )}

        {/* Current message */}
        <div className="p-3 bg-muted rounded-[10px]">
          <p className="text-body2 text-gray">{status.message}</p>
        </div>

        {/* Error display */}
        {isError && status.error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-[10px]">
            <p className="text-caption text-red-400">{status.error}</p>
          </div>
        )}

        {/* Success message */}
        {isComplete && (
          <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-[10px]">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <p className="text-caption text-green-400">
                Operation completed successfully
              </p>
            </div>
          </div>
        )}

        {/* Close button for complete/error state */}
        {canClose && onClose && (
          <button
            onClick={onClose}
            className={cn(
              "w-full mt-4 py-2.5 rounded-[10px] text-body2 transition-colors",
              isComplete
                ? "bg-privacy hover:bg-privacy/80 text-background"
                : "bg-gray/20 hover:bg-gray/30 text-foreground"
            )}
          >
            {isComplete ? "Done" : "Close"}
          </button>
        )}

        {/* Privacy notice */}
        {!canClose && (
          <p className="mt-4 text-caption text-gray text-center">
            ZK proof generation may take a few seconds...
          </p>
        )}
      </div>
    </div>
  );
}

export default OperationStatus;
