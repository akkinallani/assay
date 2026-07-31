interface Props {
  recommendation: string;
}

const CONFIG: Record<string, { label: string; className: string }> = {
  clear: { label: "Clear", className: "bg-success-50 text-success-700" },
  spot_check: { label: "Spot Check", className: "bg-warning-50 text-warning-700" },
  re_review: { label: "Re-Review", className: "bg-danger-50 text-danger-700" },
};

export function RecommendationBadge({ recommendation }: Props) {
  const cfg = CONFIG[recommendation] ?? { label: recommendation, className: "bg-gray-100 text-gray-800" };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors duration-150 ease-out ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}
