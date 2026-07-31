import { useEffect, useState, type CSSProperties } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type WorkUnitRow, type VerdictRow } from "../api/client.js";
import { RiskDial } from "../components/RiskDial.js";
import { RecommendationBadge } from "../components/RecommendationBadge.js";
import { SignalBadge } from "../components/SignalBadge.js";

type UnitWithVerdict = WorkUnitRow & { verdict: VerdictRow };

function ItemDetailSkeleton() {
  return (
    <div className="p-8">
      <div className="skeleton h-6 w-48 mb-6" />
      <div className="skeleton h-24 rounded-lg mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="skeleton h-24 rounded-md" />
          <div className="skeleton h-24 rounded-md" />
          <div className="skeleton h-24 rounded-md" />
        </div>
        <div className="skeleton h-64 rounded-md" />
      </div>
    </div>
  );
}

export function ItemDetail() {
  const { batchId, unitId } = useParams<{ batchId: string; unitId: string }>();
  const [data, setData] = useState<UnitWithVerdict | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batchId || !unitId) return;
    api.getUnit(batchId, unitId)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [batchId, unitId]);

  if (loading) return <ItemDetailSkeleton />;
  if (error) return <div className="animate-fade-up p-8 text-red-600">Error: {error}</div>;
  if (!data) return null;

  const regradeSignal = data.signals.find((s) => s.key === "regrade");
  const regradeDetail = regradeSignal?.detail as {
    agentScore: number; agentMaxScore: number; agentReasoning: string;
    toolOutputs: Array<{ tool: string; output: string }>;
  } | undefined;

  const sections = [
    { heading: "Task", content: data.task },
    { heading: "Model Output", content: data.modelOutput, pre: true },
  ];

  return (
    <div className="p-8">
      <div className="animate-fade-up flex items-center gap-4 mb-6">
        <Link to={`/app/batches/${batchId}`} className="pressable inline-block text-quorum-600 hover:underline text-sm">
          ← Queue
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Item Detail</h1>
        <span className="text-sm text-gray-500 font-mono">{unitId}</span>
      </div>

      <div className="animate-fade-up flex items-center gap-4 mb-6 p-4 rounded-lg bg-white border border-gray-200 shadow-card">
        {data.verdict && (
          <>
            <RiskDial risk={data.verdict.risk} size={64} />
            <div>
              <RecommendationBadge recommendation={data.verdict.recommendation} />
              <p className="text-sm text-gray-500 mt-1">Risk score: {(data.verdict.risk * 100).toFixed(0)}%</p>
            </div>
          </>
        )}
        <div className="ml-auto text-right">
          <p className="text-xs text-gray-500 uppercase tracking-wide">{data.domain}</p>
          <p className="text-sm text-gray-700">Grader {data.graderId}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          {sections.map((s, i) => (
            <section key={s.heading} className="stagger-item" style={{ "--stagger-index": i } as CSSProperties}>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{s.heading}</h2>
              {s.pre ? (
                <pre className="text-sm text-gray-800 bg-white border border-gray-200 rounded-md p-3 whitespace-pre-wrap">
                  {s.content}
                </pre>
              ) : (
                <p className="text-sm text-gray-800 bg-white border border-gray-200 rounded-md p-3">{s.content}</p>
              )}
            </section>
          ))}

          <section className="stagger-item" style={{ "--stagger-index": 2 } as CSSProperties}>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Human Grade — {data.grade.score}/{data.grade.maxScore}
            </h2>
            <p className="text-sm text-gray-800 bg-white border border-gray-200 rounded-md p-3">
              {data.grade.reasoning}
            </p>
          </section>

          <section className="stagger-item" style={{ "--stagger-index": 3 } as CSSProperties}>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Signals</h2>
            <div className="space-y-2">
              {data.signals.map((s) => (
                <SignalBadge key={s.id} signalKey={s.key} fired={s.fired} evidence={s.evidence} />
              ))}
              {data.signals.filter((s) => !s.fired).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 p-2 rounded-md bg-gray-50 border border-gray-200 text-xs text-gray-500"
                >
                  <span className="font-medium capitalize">{s.key}:</span>
                  <span>{s.evidence}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {regradeDetail ? (
          <div className="animate-fade-up space-y-4">
            <section>
              <h2 className="text-sm font-semibold text-quorum-700 uppercase tracking-wide mb-2">
                Agent Re-Grade — {regradeDetail.agentScore}/{regradeDetail.agentMaxScore}
              </h2>
              <p className="text-sm text-gray-800 bg-quorum-50 border border-quorum-100 rounded-md p-3">
                {regradeDetail.agentReasoning}
              </p>
            </section>
            {regradeDetail.toolOutputs.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Tool Outputs</h2>
                {regradeDetail.toolOutputs.map((t, i) => (
                  <div key={i} className="mb-2">
                    <p className="text-xs font-mono text-gray-500 mb-1">{t.tool}</p>
                    <pre className="text-xs bg-gray-900 text-green-400 rounded-md p-2 overflow-x-auto">{t.output}</pre>
                  </div>
                ))}
              </section>
            )}
          </div>
        ) : (
          <div className="animate-fade-up flex items-center justify-center h-32 bg-gray-50 rounded-lg border border-dashed border-gray-300 text-gray-400 text-sm">
            Agent re-grade pending or not triggered
          </div>
        )}
      </div>
    </div>
  );
}
