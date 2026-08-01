import { useEffect, useState } from "react";
import { api, type AccuracyReport } from "../api/client.js";
import type { GraderScorecard } from "@quorum/schema";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function precisionColor(v: number | null): string {
  if (v === null) return "text-gray-400";
  return v > 0.7 ? "text-success-600" : v > 0.4 ? "text-warning-600" : "text-danger-600";
}

function ScorecardSkeleton() {
  return (
    <div className="p-8">
      <div className="skeleton h-8 w-56 mb-6" />
      <div className="skeleton h-56 rounded-lg mb-8" />
      <div className="skeleton h-48 rounded-lg" />
    </div>
  );
}

export function Scorecard() {
  const [scorecards, setScorecards] = useState<GraderScorecard[]>([]);
  const [accuracy, setAccuracy] = useState<AccuracyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getGraders(), api.getAccuracy()])
      .then(([g, a]) => {
        setScorecards(g);
        setAccuracy(a);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <ScorecardSkeleton />;
  if (error) return <div className="animate-fade-up p-8 text-red-600">Error: {error}</div>;

  const chartData = scorecards
    .sort((a, b) => b.flagRate - a.flagRate)
    .map((g) => ({ name: g.graderId, flagRate: Math.round(g.flagRate * 100) }));

  return (
    <div className="p-8">
      <h1 className="animate-fade-up text-2xl font-bold text-gray-900 mb-6">Grader Scorecards</h1>

      <div className="animate-fade-up mb-8 bg-white rounded-lg border border-gray-200 shadow-card p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Assay Accuracy</h2>
        {!accuracy || accuracy.overall.resolvedCount === 0 ? (
          <div className="flex items-center justify-center h-24 bg-gray-50 rounded-lg border border-dashed border-gray-300 text-gray-400 text-sm">
            Resolve flagged items to start measuring accuracy
          </div>
        ) : (
          <div>
            <div className="flex items-baseline gap-3 mb-4">
              <span className={`text-3xl font-bold ${precisionColor(accuracy.overall.precision)}`}>
                {pct(accuracy.overall.precision)}
              </span>
              <span className="text-sm text-gray-500">
                precision on {accuracy.overall.resolvedCount} resolved flagged item
                {accuracy.overall.resolvedCount === 1 ? "" : "s"} ({accuracy.overall.confirmedCount} confirmed,{" "}
                {accuracy.overall.falsePositiveCount} false positive)
              </span>
            </div>
            {accuracy.bySignal.length > 0 && (
              <div className="space-y-2">
                {accuracy.bySignal
                  .sort((a, b) => b.firedCount - a.firedCount)
                  .map((s) => (
                    <div key={s.key} className="flex items-center gap-3 text-sm">
                      <span className="w-28 font-mono text-gray-600 capitalize">{s.key}</span>
                      <span className={`w-12 text-right font-semibold ${precisionColor(s.precision)}`}>
                        {pct(s.precision)}
                      </span>
                      <span className="text-xs text-gray-400">
                        {s.confirmedCount}/{s.firedCount} confirmed
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="animate-fade-up mb-8 bg-white rounded-lg border border-gray-200 shadow-card p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Flag Rate by Grader</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis unit="%" tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(v) => [`${v}%`, "Flag Rate"]}
              cursor={{ fill: "rgba(111, 92, 240, 0.06)" }}
              contentStyle={{
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                boxShadow: "0 8px 24px -8px rgba(30,20,90,0.16)",
              }}
            />
            <Bar dataKey="flagRate" radius={[4, 4, 0, 0]} animationDuration={500} animationEasing="ease-out">
              {chartData.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.flagRate > 30 ? "#a8453a" : entry.flagRate > 15 ? "#b07f2c" : "#5c7a48"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="animate-fade-up overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-card">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wide">
              <th className="py-3 pl-4 pr-4">Grader</th>
              <th className="py-3 pr-4 text-right">Items</th>
              <th className="py-3 pr-4 text-right">Flag Rate</th>
              <th className="py-3 pr-4 text-right">Agreement w/ Agent</th>
            </tr>
          </thead>
          <tbody>
            {scorecards
              .sort((a, b) => b.flagRate - a.flagRate)
              .map((g) => (
                <tr
                  key={g.graderId}
                  className="border-b border-gray-100 last:border-0 transition-colors duration-150 ease-out hover:bg-gray-50"
                >
                  <td className="py-2.5 pl-4 pr-4 font-mono">{g.graderId}</td>
                  <td className="py-2.5 pr-4 text-right text-gray-600">{g.itemsSeen}</td>
                  <td className="py-2.5 pr-4 text-right">
                    <span
                      className={`font-semibold ${
                        g.flagRate > 0.3 ? "text-danger-600" : g.flagRate > 0.15 ? "text-warning-600" : "text-success-600"
                      }`}
                    >
                      {Math.round(g.flagRate * 100)}%
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-right text-gray-600">
                    {Math.round(g.agreementWithRegrade * 100)}%
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
