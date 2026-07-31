import { useEffect, useState, type CSSProperties } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type VerdictRow } from "../api/client.js";
import { RiskDial } from "../components/RiskDial.js";
import { RecommendationBadge } from "../components/RecommendationBadge.js";
import { SignalBadge } from "../components/SignalBadge.js";

function VerdictQueueSkeleton() {
  return (
    <div className="p-8">
      <div className="skeleton h-8 w-64 mb-6" />
      <div className="flex gap-4 mb-6">
        <div className="skeleton h-7 w-24 rounded-full" />
        <div className="skeleton h-7 w-24 rounded-full" />
        <div className="skeleton h-7 w-20 rounded-full" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-24 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function VerdictQueue() {
  const { batchId } = useParams<{ batchId: string }>();
  const [verdicts, setVerdicts] = useState<VerdictRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batchId) return;
    api.getVerdicts(batchId)
      .then(setVerdicts)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [batchId]);

  if (loading) return <VerdictQueueSkeleton />;
  if (error) return <div className="animate-fade-up p-8 text-red-600">Error: {error}</div>;

  const reReview = verdicts.filter((v) => v.recommendation === "re_review");
  const spotCheck = verdicts.filter((v) => v.recommendation === "spot_check");
  const clear = verdicts.filter((v) => v.recommendation === "clear");

  return (
    <div className="p-8">
      <div className="animate-fade-up flex items-center gap-4 mb-6">
        <Link to="/app" className="pressable inline-block text-quorum-600 hover:underline text-sm">
          ← Batches
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Re-Review Queue</h1>
        <span className="text-sm text-gray-500 font-mono">{batchId}</span>
      </div>

      <div className="animate-fade-up flex gap-4 mb-6 text-sm">
        <div className="px-3 py-1 rounded-full bg-red-100 text-red-700">{reReview.length} re-review</div>
        <div className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-700">{spotCheck.length} spot check</div>
        <div className="px-3 py-1 rounded-full bg-green-100 text-green-700">{clear.length} clear</div>
      </div>

      <div className="space-y-3">
        {verdicts.map((v, i) => (
          <Link
            key={v.id}
            to={`/app/batches/${batchId}/units/${v.workUnitId}`}
            className="pressable card-interactive stagger-item block p-4 rounded-lg border border-gray-200 bg-white hover:border-quorum-300"
            style={{ "--stagger-index": i } as CSSProperties}
          >
            <div className="flex items-start gap-4">
              <RiskDial risk={v.risk} size={48} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <RecommendationBadge recommendation={v.recommendation} />
                  <span className="text-xs text-gray-500 uppercase tracking-wide">{v.workUnit.domain}</span>
                  <span className="text-xs text-gray-400">Grader {v.workUnit.graderId}</span>
                  <span className="text-xs text-gray-400 ml-auto">
                    {v.workUnit.grade.score}/{v.workUnit.grade.maxScore}
                  </span>
                </div>
                <p className="text-sm text-gray-700 truncate">{v.workUnit.task}</p>
                <div className="mt-2 space-y-1">
                  {v.workUnit.signals.filter((s) => s.fired).map((s) => (
                    <SignalBadge key={s.id} signalKey={s.key} fired={s.fired} evidence={s.evidence} />
                  ))}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
