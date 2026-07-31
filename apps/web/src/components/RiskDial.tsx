import { useEffect, useState } from "react";

interface Props {
  risk: number;
  size?: number;
}

export function RiskDial({ risk, size = 48 }: Props) {
  const pct = Math.min(1, Math.max(0, risk));
  const color = pct > 0.6 ? "#ef4444" : pct > 0.25 ? "#f59e0b" : "#22c55e";
  const circumference = 2 * Math.PI * 18;

  // Animate from empty on mount so the dial visibly fills in, rather than
  // snapping straight to its final value.
  const [offset, setOffset] = useState(circumference);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOffset(circumference * (1 - pct)));
    return () => cancelAnimationFrame(frame);
  }, [pct, circumference]);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 44 44" className="-rotate-90">
        <circle cx="22" cy="22" r="18" fill="none" stroke="#e5e7eb" strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r="18"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{
            transition: "stroke-dashoffset 700ms cubic-bezier(0.23, 1, 0.32, 1), stroke 300ms ease-out",
          }}
        />
      </svg>
      <span
        className="absolute text-xs font-bold transition-colors duration-300 ease-out"
        style={{ color }}
      >
        {Math.round(pct * 100)}
      </span>
    </div>
  );
}
