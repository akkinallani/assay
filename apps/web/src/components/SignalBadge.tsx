interface Props {
  signalKey: string;
  fired: boolean;
  evidence: string;
}

const KEY_LABELS: Record<string, string> = {
  consistency: "Consistency",
  coverage: "Coverage",
  cohort: "Cohort",
  regrade: "Agent Re-grade",
};

export function SignalBadge({ signalKey, fired, evidence }: Props) {
  if (!fired) return null;
  return (
    <div className="animate-fade-up flex items-start gap-2 p-2 rounded-md bg-red-50 border border-red-200 text-sm">
      <span className="font-semibold text-red-700 shrink-0">{KEY_LABELS[signalKey] ?? signalKey}:</span>
      <span className="text-red-600">{evidence}</span>
    </div>
  );
}
